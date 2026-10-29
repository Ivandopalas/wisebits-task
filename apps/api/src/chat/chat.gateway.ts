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
import { TokenExpiredException, TokensService } from '../auth/tokens.service.js';
import { createValidationPipe } from '../common/validation.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import {
  RealtimeService,
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
  private closing = false;

  constructor(
    private readonly tokens: TokensService,
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
    const { userId } = socket.data;
    this.logger.log({ userId, socketId: socket.id }, 'Socket connected');
    await socket.join(userRoom(userId));
    await this.broadcastPresence(userId, true);
  }

  handleDisconnect(socket: ChatSocket) {
    this.limiter.forget(socket.id);
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
  }

  @SubscribeMessage('message:send')
  async send(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody({ schema: wsSendMessageSchema }) payload: WsSendMessagePayload,
  ): Promise<AckResponse<MessageDto>> {
    this.throttle(socket, 'send');
    const { message } = await this.messages.send(
      payload.conversationId,
      socket.data.userId,
      payload,
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
    let user;
    try {
      user = await this.tokens.verifyAccess(token);
    } catch (error) {
      throw error instanceof TokenExpiredException
        ? SOCKET_ERROR.tokenExpired
        : SOCKET_ERROR.unauthorized;
    }
    if (!(await this.users.exists(user.id))) {
      throw SOCKET_ERROR.unauthorized;
    }
    socket.data = { userId: user.id, username: user.username };
  }

  private async broadcastPresence(userId: string, online: boolean) {
    const partners = await this.conversations.partnerIds(userId);
    this.realtime.emitToUsers(partners, 'presence', { userId, online });
  }

  private throttle(socket: ChatSocket, event: keyof typeof LIMITS_PER_SECOND) {
    if (!this.limiter.take(socket.id, event, LIMITS_PER_SECOND[event])) {
      throw new HttpException('Too many events, slow down', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
