import { Injectable, Logger } from '@nestjs/common';
import type { ClientToServerEvents, ServerToClientEvents } from '@chat/shared';
import type { Server } from 'socket.io';

export interface SocketData {
  userId: string;
  username: string;
}

/** Requests between API instances; they travel through the adapter and never reach clients. */
export interface InstanceEvents {
  'presence:local': (userIds: string[], reply: (online: string[]) => void) => void;
}

export type ChatServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InstanceEvents,
  SocketData
>;
type EventArgs<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>;

/** Every socket of a user joins this room: one emit reaches all their tabs on all instances. */
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Lets services push events without depending on the gateway. With the MongoDB adapter an emit
 * to a room reaches sockets connected to any API instance.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: ChatServer | null = null;

  attach(server: ChatServer): void {
    this.server = server;
    server.on('presence:local', (userIds, reply) => {
      this.localOnline(userIds).then(reply, () => reply([]));
    });
  }

  emitToUsers<E extends keyof ServerToClientEvents>(
    userIds: string[],
    event: E,
    ...args: EventArgs<E>
  ) {
    if (userIds.length > 0) {
      this.server?.to(userIds.map(userRoom)).emit(event, ...args);
    }
  }

  emitToAll<E extends keyof ServerToClientEvents>(event: E, ...args: EventArgs<E>) {
    this.server?.emit(event, ...args);
  }

  /**
   * Asks every instance which of these users have a connected socket. An instance that does not
   * answer in time counts as having none: it has most likely crashed, and the others keep
   * waiting for it until its heartbeats are overdue. Its sockets died with it, and their users
   * reconnect to an instance that does answer.
   */
  async onlineUsers(userIds: string[]): Promise<Set<string>> {
    if (!this.server || userIds.length === 0) {
      return new Set();
    }
    const [local, remote] = await Promise.all([
      this.localOnline(userIds),
      this.server
        .serverSideEmitWithAck('presence:local', userIds)
        .catch((error: Error & { responses?: string[][] }) => {
          this.logger.warn({ err: error }, 'An instance did not answer the presence query');
          return error.responses ?? [];
        }),
    ]);
    return new Set([...local, ...remote.flat()]);
  }

  private async localOnline(userIds: string[]): Promise<string[]> {
    const sockets = await this.server!.local.in(userIds.map(userRoom)).fetchSockets();
    return [...new Set(sockets.map((s) => s.data.userId))];
  }
}
