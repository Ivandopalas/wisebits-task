import { SOCKET_ERROR } from '@chat/shared';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeSocket {
  connected = false;
  active = true;
  private readonly handlers = new Map<string, (...args: unknown[]) => void>();

  readonly connect = vi.fn(() => {
    this.active = true;
    return this;
  });
  readonly disconnect = vi.fn(() => {
    this.active = false;
    if (this.connected) {
      this.connected = false;
      this.fire('disconnect', 'io client disconnect');
    }
    return this;
  });
  readonly removeAllListeners = vi.fn();
  readonly timeout = vi.fn(() => ({ emitWithAck: vi.fn(async () => ({ ok: true })) }));

  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, handler);
    return this;
  }

  fire(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.(...args);
  }

  /** The handshake went through. */
  open() {
    this.connected = true;
    this.fire('connect');
  }

  /** The server's auth middleware turned the handshake down: socket.io gives up on its own. */
  reject(code: string) {
    this.active = false;
    this.fire('connect_error', Object.assign(new Error(code), { data: { code } }));
  }
}

const sockets = vi.hoisted(() => ({ created: [] as unknown[] }));

vi.mock('socket.io-client', () => ({
  io: () => {
    const socket = new FakeSocket();
    sockets.created.push(socket);
    return socket;
  },
}));

const { closeSocket, connection, openSocket } = await import('./client.js');

function setup() {
  const options = {
    token: vi.fn(async () => 'token'),
    refresh: vi.fn<() => Promise<string | null>>(async () => 'new-token'),
    onUnauthorized: vi.fn(),
    onConnect: vi.fn(),
  };
  openSocket(options);
  return { options, socket: sockets.created.at(-1) as FakeSocket };
}

describe('chat socket', () => {
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const browser = { onLine: true };

  beforeEach(() => {
    vi.useFakeTimers();
    page.visibilityState = 'visible';
    browser.onLine = true;
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', page);
    vi.stubGlobal('navigator', browser);
  });

  afterEach(() => {
    closeSocket();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('when the server rejects the token', () => {
    it('reconnects with a refreshed one', async () => {
      const { options, socket } = setup();
      socket.reject(SOCKET_ERROR.tokenExpired);
      await vi.advanceTimersByTimeAsync(0);

      expect(options.refresh).toHaveBeenCalledOnce();
      expect(socket.connect).toHaveBeenCalledOnce();
      expect(options.onUnauthorized).not.toHaveBeenCalled();
    });

    it('signs out when the session cannot be refreshed', async () => {
      const { options, socket } = setup();
      options.refresh.mockResolvedValue(null);
      socket.reject(SOCKET_ERROR.tokenExpired);
      await vi.advanceTimersByTimeAsync(0);

      expect(options.onUnauthorized).toHaveBeenCalledOnce();
      expect(socket.connect).not.toHaveBeenCalled();
    });

    it('tries again later when the refresh itself did not get through', async () => {
      const { options, socket } = setup();
      options.refresh.mockRejectedValue(new Error('offline'));
      socket.reject(SOCKET_ERROR.tokenExpired);
      await vi.advanceTimersByTimeAsync(2000);

      expect(socket.connect).toHaveBeenCalledOnce();
      expect(options.onUnauthorized).not.toHaveBeenCalled();
    });
  });

  it('leaves a network error to the retries of socket.io', async () => {
    const { options, socket } = setup();
    socket.fire('connect_error', new Error('websocket error'));
    await vi.advanceTimersByTimeAsync(0);

    expect(get(connection)).toBe('offline');
    expect(options.refresh).not.toHaveBeenCalled();
  });

  it('tells which connections are resumed ones', () => {
    const { options, socket } = setup();
    socket.open();
    socket.connected = false;
    socket.fire('disconnect', 'transport close');
    socket.open();

    expect(options.onConnect.mock.calls).toEqual([[false], [true]]);
  });
});
