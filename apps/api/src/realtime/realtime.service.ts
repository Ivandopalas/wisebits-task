import { Injectable } from '@nestjs/common';
import type { ClientToServerEvents, ServerToClientEvents } from '@chat/shared';
import type { Server } from 'socket.io';

export interface SocketData {
  userId: string;
  username: string;
}

export type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type EventArgs<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>;

/** Every socket of a user joins this room: one emit reaches all their tabs on all instances. */
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Lets services push events without depending on the gateway. With the MongoDB adapter an emit
 * to a room reaches sockets connected to any API instance.
 */
@Injectable()
export class RealtimeService {
  private server: ChatServer | null = null;

  attach(server: ChatServer): void {
    this.server = server;
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

  /** Asks every instance which of these users have at least one connected socket. */
  async onlineUsers(userIds: string[]): Promise<Set<string>> {
    if (!this.server || userIds.length === 0) {
      return new Set();
    }
    const sockets = await this.server.in(userIds.map(userRoom)).fetchSockets();
    return new Set(sockets.map((s) => s.data.userId));
  }
}
