import type { ClientToServerEvents, ServerToClientEvents } from '@chat/shared';
import { io, type Socket } from 'socket.io-client';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const openSockets = new Set<ClientSocket>();

export function connect(baseUrl: string, token?: string): Promise<ClientSocket> {
  const socket: ClientSocket = io(baseUrl, {
    transports: ['websocket'],
    auth: token ? { token } : {},
    reconnection: false,
    forceNew: true,
  });
  openSockets.add(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

export function connectError(
  baseUrl: string,
  token?: string,
): Promise<{ message: string; code?: string }> {
  return connect(baseUrl, token).then(
    () => {
      throw new Error('Expected the connection to be rejected');
    },
    (error: Error & { data?: { code?: string } }) => ({
      message: error.message,
      code: error.data?.code,
    }),
  );
}

export function disconnectAll(): void {
  openSockets.forEach((s) => s.disconnect());
  openSockets.clear();
}

/** Resolves with the next event payload, or rejects after `timeoutMs`. */
export function nextEvent<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  timeoutMs = 3000,
  filter: (payload: Parameters<ServerToClientEvents[E]>[0]) => boolean = () => true,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload: Parameters<ServerToClientEvents[E]>[0]) => {
      if (!filter(payload)) {
        return;
      }
      clearTimeout(timer);
      socket.off(event, handler as never);
      resolve(payload);
    };
    socket.on(event, handler as never);
  });
}

/** Resolves with the reason the socket closes for, or rejects after `timeoutMs`. */
export function nextDisconnect(socket: ClientSocket, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for "disconnect"')),
      timeoutMs,
    );
    socket.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

/** Resolves true if no matching event arrives within the window. */
export function noEvent<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  windowMs = 500,
  filter: (payload: Parameters<ServerToClientEvents[E]>[0]) => boolean = () => true,
): Promise<boolean> {
  return nextEvent(socket, event, windowMs, filter).then(
    () => false,
    () => true,
  );
}
