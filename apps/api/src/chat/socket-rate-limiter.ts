/**
 * Fixed-window counter per socket and event. A socket lives on exactly one instance, so local
 * memory is the right place for it; no shared store is needed.
 */
export class SocketRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(private readonly windowMs = 1000) {}

  take(socketId: string, event: string, limit: number, now = Date.now()): boolean {
    const key = `${socketId}:${event}`;
    const window = this.windows.get(key);
    if (!window || now - window.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= limit;
  }

  forget(socketId: string): void {
    for (const key of this.windows.keys()) {
      if (key.startsWith(`${socketId}:`)) {
        this.windows.delete(key);
      }
    }
  }
}
