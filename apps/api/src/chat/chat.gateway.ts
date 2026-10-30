import {
  HttpException,
  HttpStatus,
  Logger,
  type OnModuleDestroy,
  UseFilters,
  UsePipes,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import {
  SOCKET_ERROR,
  wsMarkReadSchema,
  wsPresenceQuerySchema,
  wsSendMessageSchema,
  wsTypingSchema,
  type AckResponse,
  type MessageDto,
  type SocketErrorCode,
  type WsMarkReadPayload,
  type WsPresenceQueryPayload,
  type WsSendMessagePayload,
  type WsTypingPayload,
} from '@chat/shared';
import type { Socket } from 'socket.io';
import { SessionsService } from '../auth/sessions.service.js';
import { TokenExpiredException, TokensService } from '../auth/tokens.service.js';
import { createValidationPipe } from '../common/validation.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import {
  RealtimeService,
  sessionRoom,
  userRoom,
  type ChatServer,
  type SocketData,
} from '../realtime/realtime.service.js';
import { UsersService } from '../users/users.service.js';
import { SocketRateLimiter } from './socket-rate-limiter.js';
import { WsAckExceptionFilter } from './ws-ack-exception.filter.js';

type ChatSocket = Socket<object, object, object, SocketData>;

/** A page reload drops and restores the socket within this window; don't flash "offline". */
export const PRESENCE_OFFLINE_DELAY_MS = 2000;

const LIMITS_PER_SECOND = { send: 10, read: 10, typing: 5, presence: 5 };

@WebSocketGateway({ transports: ['websocket'] })
@UsePipes(createValidationPipe())
@UseFilters(WsAckExceptionFilter)
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(ChatGateway.name);
  private readonly limiter = new SocketRateLimiter();
  private readonly offlineTimers = new Set<NodeJS.Timeout>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private readonly sendQueues = new Map<string, Promise<void>>();
  private closing = false;

  constructor(
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: ChatServer) {
    this.realtime.attach(server);
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (code: SocketErrorCode) => next(Object.assign(new Error(code), { data: { code } })),
      );
    });
  }

  // Every log line carries the instance id, so these show which replica holds whom.
  async handleConnection(socket: ChatSocket) {
    const { userId, sessionId, tokenExpiresAt } = socket.data;
    this.logger.log({ userId, socketId: socket.id }, 'Socket connected');
    // The token is only read at the handshake, and pings would keep the connection up forever.
    // The client comes back with a fresh token; a stolen one stops working when it expires.
    const expiry = setTimeout(() => socket.disconnect(true), tokenExpiresAt - Date.now());
    this.expiryTimers.set(socket.id, expiry);
    await socket.join([userRoom(userId), sessionRoom(sessionId)]);
    await this.broadcastPresence(userId, true);
  }

  handleDisconnect(socket: ChatSocket) {
    this.limiter.forget(socket.id);
    clearTimeout(this.expiryTimers.get(socket.id));
    this.expiryTimers.delete(socket.id);
    const { userId } = socket.data;
    if (!userId) {
      return;
    }
    this.logger.log({ userId, socketId: socket.id }, 'Socket disconnected');
    // Shutting down closes every socket here; their users are already reconnecting elsewhere.
    if (this.closing) {
      return;
    }
    const timer = setTimeout(() => {
      this.offlineTimers.delete(timer);
      void this.realtime
        .onlineUsers([userId])
        .then((online) => (online.has(userId) ? undefined : this.broadcastPresence(userId, false)))
        .catch((err: unknown) => this.logger.warn({ err }, 'Presence check failed'));
    }, PRESENCE_OFFLINE_DELAY_MS);
    this.offlineTimers.add(timer);
  }

  onModuleDestroy() {
    this.closing = true;
    this.offlineTimers.forEach(clearTimeout);
    this.offlineTimers.clear();
    this.expiryTimers.forEach(clearTimeout);
    this.expiryTimers.clear();
  }

  @SubscribeMessage('message:send')
  async send(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody({ schema: wsSendMessageSchema }) payload: WsSendMessagePayload,
  ): Promise<AckResponse<MessageDto>> {
    this.throttle(socket, 'send');
    const { message } = await this.inArrivalOrder(socket.id, () =>
      this.messages.send(payload.conversationId, socket.data.userId, payload),
    );
    return { ok: true, data: message };
  }

  @SubscribeMessage('conversation:read')
  async read(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody({ schema: wsMarkReadSchema }) payload: WsMarkReadPayload,
  ): Promise<AckResponse<{ seq: number }>> {
    this.throttle(socket, 'read');
    const result = await this.messages.markRead(
      payload.conversationId,
      socket.data.userId,
      payload.seq,
    );
    return { ok: true, data: result };
  }

  @SubscribeMessage('typing')
  async typing(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody({ schema: wsTypingSchema }) payload: WsTypingPayload,
  ): Promise<void> {
    if (!this.limiter.take(socket.id, 'typing', LIMITS_PER_SECOND.typing)) {
      return;
    }
    const { userId } = socket.data;
    const conversation = await this.conversations.requireParticipant(
      payload.conversationId,
      userId,
    );
    const peerId = conversation.participants.map(String).find((id) => id !== userId)!;
    this.realtime.emitToUsers([peerId], 'typing', {
      conversationId: payload.conversationId,
      userId,
      isTyping: payload.isTyping,
    });
  }

  @SubscribeMessage('presence:query')
  async presence(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody({ schema: wsPresenceQuerySchema }) payload: WsPresenceQueryPayload,
  ): Promise<AckResponse<Record<string, boolean>>> {
    this.throttle(socket, 'presence');
    const online = await this.realtime.onlineUsers(payload.userIds);
    return {
      ok: true,
      data: Object.fromEntries(payload.userIds.map((id) => [id, online.has(id)])),
    };
  }

  private async authenticate(socket: ChatSocket): Promise<void> {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      throw SOCKET_ERROR.unauthorized;
    }
    let claims;
    try {
      claims = await this.tokens.verifyAccess(token);
    } catch (error) {
      throw error instanceof TokenExpiredException
        ? SOCKET_ERROR.tokenExpired
        : SOCKET_ERROR.unauthorized;
    }
    // The token outlives a logout; without this it would reopen the socket that logout closed.
    const [userExists, sessionActive] = await Promise.all([
      this.users.exists(claims.id),
      this.sessions.isActive(claims.sessionId),
    ]);
    if (!userExists || !sessionActive) {
      throw SOCKET_ERROR.unauthorized;
    }
    socket.data = {
      userId: claims.id,
      username: claims.username,
      sessionId: claims.sessionId,
      tokenExpiresAt: claims.expiresAt,
    };
  }

  private async broadcastPresence(userId: string, online: boolean) {
    const partners = await this.conversations.partnerIds(userId);
    this.realtime.emitToUsers(partners, 'presence', { userId, online });
  }

  /**
   * A socket delivers events in order, but concurrent transactions would take `seq` in whatever
   * order they commit. Running one socket's sends one by one keeps the sender's order.
   */
  private inArrivalOrder<T>(socketId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.sendQueues.get(socketId) ?? Promise.resolve()).then(task);
    // A failed send must not hold up the ones behind it.
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.sendQueues.set(socketId, tail);
    void tail.then(() => {
      if (this.sendQueues.get(socketId) === tail) {
        this.sendQueues.delete(socketId);
      }
    });
    return run;
  }

  private throttle(socket: ChatSocket, event: keyof typeof LIMITS_PER_SECOND) {
    if (!this.limiter.take(socket.id, event, LIMITS_PER_SECOND[event])) {
      throw new HttpException('Too many events, slow down', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
