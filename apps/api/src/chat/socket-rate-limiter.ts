interface Window {
  startedAt: number;
  count: number;
}

/**
 * Fixed-window counter per socket and event. A socket lives on exactly one instance, so local
 * memory is the right place for it; no shared store is needed.
 */
export class SocketRateLimiter {
  private readonly sockets = new Map<string, Map<string, Window>>();

  constructor(private readonly windowMs = 1000) {}

  take(socketId: string, event: string, limit: number, now = Date.now()): boolean {
    let windows = this.sockets.get(socketId);
    if (!windows) {
      windows = new Map();
      this.sockets.set(socketId, windows);
    }
    const window = windows.get(event);
    if (!window || now - window.startedAt >= this.windowMs) {
      windows.set(event, { startedAt: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= limit;
  }

  forget(socketId: string): void {
    this.sockets.delete(socketId);
  }
}
