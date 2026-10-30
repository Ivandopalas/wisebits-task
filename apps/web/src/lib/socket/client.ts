import {
  SOCKET_ERROR,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketErrorCode,
} from '@chat/shared';
import { io, type Socket } from 'socket.io-client';
import { writable } from 'svelte/store';

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline';

export const connection = writable<ConnectionStatus>('idle');

const ACK_TIMEOUT_MS = 10_000;

let socket: ChatSocket | null = null;
let detachListeners: (() => void) | null = null;

export interface SocketOptions {
  token(): Promise<string | null>;
  refresh(): Promise<string | null>;
  /** The session is gone: the user has to sign in again. */
  onUnauthorized(): void;
  /** Fired on every successful (re)connection; `resumed` is false for the first one. */
  onConnect(resumed: boolean): void;
  onDisconnect(): void;
}

/**
 * One socket per signed-in app. The token is read on every connection attempt, so reconnects
 * after an expiry pick up a refreshed one.
 */
export function openSocket(options: SocketOptions): ChatSocket {
  closeSocket();
  let connectedBefore = false;

  const instance: ChatSocket = io({
    // nginx balances across API replicas without sticky sessions, so no long-polling fallback.
    transports: ['websocket'],
    auth: (callback) => {
      options.token().then(
        (token) => callback({ token }),
        () => callback({}),
      );
    },
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    // An attempt started while the network was down can hang instead of failing; the default
    // of 20 s would keep the user offline that long after the network is back.
    timeout: 8000,
  });
  socket = instance;
  connection.set('connecting');

  // The browser knows the network is gone: close now rather than notice by the ping timeout,
  // 45 s later, and leave the retries until it is back.
  const dropConnection = () => {
    instance.disconnect();
    connection.set('offline');
  };
  const reconnectNow = () => {
    if (!instance.connected) {
      instance.disconnect().connect();
    }
  };
  // Back on the tab after the phone slept: retry now, not after the backoff.
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      reconnectNow();
    }
  };
  window.addEventListener('offline', dropConnection);
  window.addEventListener('online', reconnectNow);
  document.addEventListener('visibilitychange', onVisibilityChange);
  detachListeners = () => {
    window.removeEventListener('offline', dropConnection);
    window.removeEventListener('online', reconnectNow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };

  instance.on('connect', () => {
    connection.set('online');
    options.onConnect(connectedBefore);
    connectedBefore = true;
  });

  instance.on('disconnect', (reason) => {
    connection.set('offline');
    options.onDisconnect();
    // The server closing the socket is not retried automatically.
    if (reason === 'io server disconnect') {
      instance.connect();
    }
  });

  instance.on('connect_error', (error: Error & { data?: { code?: SocketErrorCode } }) => {
    connection.set('offline');
    if (instance.active) {
      return; // a network problem: socket.io keeps retrying on its own
    }
    // Rejected by the server's auth middleware: retrying only helps with a new token.
    const code = error.data?.code;
    if (code === SOCKET_ERROR.tokenExpired || code === SOCKET_ERROR.unauthorized) {
      options.refresh().then(
        (token) => (token ? instance.connect() : options.onUnauthorized()),
        () => setTimeout(() => instance.connect(), 2000),
      );
    }
  });

  return instance;
}

export function closeSocket(): void {
  detachListeners?.();
  detachListeners = null;
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  connection.set('idle');
}

export function currentSocket(): ChatSocket | null {
  return socket;
}

type AckEvent = 'message:send' | 'conversation:read' | 'presence:query';
type Payload<E extends AckEvent> = Parameters<ClientToServerEvents[E]>[0];
type AckResult<E extends AckEvent> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];

/**
 * Emits with an acknowledgement; rejects if the server does not answer in time. While socket.io
 * is reconnecting the event waits for it; with nothing under way there is nothing to wait for.
 */
export function request<E extends AckEvent>(event: E, payload: Payload<E>): Promise<AckResult<E>> {
  if (!socket?.active) {
    return Promise.reject(new Error('Not connected'));
  }
  // The typed overloads cannot follow a generic event name; the signature above restores types.
  const emitter = socket.timeout(ACK_TIMEOUT_MS) as unknown as {
    emitWithAck(event: string, payload: unknown): Promise<unknown>;
  };
  return emitter.emitWithAck(event, payload) as Promise<AckResult<E>>;
}
