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

const { closeSocket, connection, openSocket, OUTAGE_GRACE_MS, request } =
  await import('./client.js');

function setup() {
  const options = {
    token: vi.fn(async () => 'token'),
    refresh: vi.fn<() => Promise<string | null>>(async () => 'new-token'),
    onUnauthorized: vi.fn(),
    onConnect: vi.fn(),
    onConnectionLost: vi.fn(),
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

  describe('when the server could not check the token', () => {
    it('tries again shortly with the same one', async () => {
      const { options, socket } = setup();
      socket.reject(SOCKET_ERROR.unavailable);

      await vi.advanceTimersByTimeAsync(1999);
      expect(socket.connect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(socket.connect).toHaveBeenCalledOnce();
      expect(options.refresh).not.toHaveBeenCalled();
    });

    it('does not come back after the user has signed out', async () => {
      const { socket } = setup();
      socket.reject(SOCKET_ERROR.unavailable);

      closeSocket();
      await vi.advanceTimersByTimeAsync(2000);

      expect(socket.connect).not.toHaveBeenCalled();
    });
  });

  it('leaves a network error to the retries of socket.io', async () => {
    const { options, socket } = setup();
    socket.fire('connect_error', new Error('websocket error'));
    await vi.advanceTimersByTimeAsync(OUTAGE_GRACE_MS);

    expect(get(connection)).toBe('offline');
    expect(options.refresh).not.toHaveBeenCalled();
  });

  describe('when the connection drops', () => {
    it('keeps quiet about a routine reconnect, like the one after a token expires', async () => {
      const { options, socket } = setup();
      socket.open();

      socket.connected = false;
      socket.fire('disconnect', 'io server disconnect');
      await vi.advanceTimersByTimeAsync(OUTAGE_GRACE_MS - 1);
      expect(get(connection)).toBe('online');
      socket.open();
      await vi.advanceTimersByTimeAsync(OUTAGE_GRACE_MS);

      expect(get(connection)).toBe('online');
      expect(options.onConnectionLost).not.toHaveBeenCalled();
    });

    it('reports it once the reconnect takes longer than that', async () => {
      const { options, socket } = setup();
      socket.open();

      socket.connected = false;
      socket.fire('disconnect', 'transport close');
      await vi.advanceTimersByTimeAsync(OUTAGE_GRACE_MS);

      expect(get(connection)).toBe('offline');
      expect(options.onConnectionLost).toHaveBeenCalledOnce();
    });
  });

  describe('when the browser reports the network gone', () => {
    function goOffline() {
      browser.onLine = false;
      window.dispatchEvent(new Event('offline'));
    }

    it('drops the connection at once instead of waiting for the ping timeout', async () => {
      const { options, socket } = setup();
      socket.open();

      goOffline();
      expect(socket.connected).toBe(false);
      await vi.advanceTimersByTimeAsync(OUTAGE_GRACE_MS);

      expect(get(connection)).toBe('offline');
      expect(options.onConnectionLost).toHaveBeenCalledOnce();
    });

    it('reports it while a connection attempt is still under way, too', async () => {
      setup();
      expect(get(connection)).toBe('connecting');

      goOffline();
      await vi.advanceTimersByTimeAsync(OUTAGE_GRACE_MS);

      expect(get(connection)).toBe('offline');
    });

    it('leaves the reconnect to the network coming back', async () => {
      const { socket } = setup();
      socket.reject(SOCKET_ERROR.unavailable);

      goOffline();
      await vi.advanceTimersByTimeAsync(2000);

      expect(socket.connect).not.toHaveBeenCalled();
    });

    it('fails requests at once rather than after the ack timeout', async () => {
      const { socket } = setup();
      socket.open();
      goOffline();

      await expect(request('conversation:read', { conversationId: 'c1', seq: 1 })).rejects.toThrow(
        'Not connected',
      );
      expect(socket.timeout).not.toHaveBeenCalled();
    });

    it('does not try to connect from a tab brought back to the front', () => {
      const { socket } = setup();
      socket.open();
      goOffline();

      document.dispatchEvent(new Event('visibilitychange'));

      expect(socket.connect).not.toHaveBeenCalled();
    });

    it('reconnects when the network is back, even in a hidden tab', () => {
      const { socket } = setup();
      socket.open();
      goOffline();
      page.visibilityState = 'hidden';

      browser.onLine = true;
      window.dispatchEvent(new Event('online'));

      expect(socket.connect).toHaveBeenCalledOnce();
    });
  });

  it('retries at once when the user returns to the tab, not after the backoff', () => {
    const { socket } = setup();
    socket.fire('connect_error', new Error('websocket error'));

    document.dispatchEvent(new Event('visibilitychange'));

    expect(socket.connect).toHaveBeenCalledOnce();
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
