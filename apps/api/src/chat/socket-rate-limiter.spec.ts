import { SocketRateLimiter } from './socket-rate-limiter.js';

describe('SocketRateLimiter', () => {
  it('allows up to the limit within a window, then blocks', () => {
    const limiter = new SocketRateLimiter(1000);
    const results = Array.from({ length: 4 }, () => limiter.take('s1', 'send', 3, 0));
    expect(results).toEqual([true, true, true, false]);
  });

  it('starts a new window after it elapses', () => {
    const limiter = new SocketRateLimiter(1000);
    limiter.take('s1', 'send', 1, 0);
    expect(limiter.take('s1', 'send', 1, 500)).toBe(false);
    expect(limiter.take('s1', 'send', 1, 1000)).toBe(true);
  });

  it('counts sockets and events separately and forgets closed sockets', () => {
    const limiter = new SocketRateLimiter(1000);
    expect(limiter.take('s1', 'send', 1, 0)).toBe(true);
    expect(limiter.take('s1', 'typing', 1, 0)).toBe(true);
    expect(limiter.take('s2', 'send', 1, 0)).toBe(true);
    limiter.forget('s1');
    expect(limiter.take('s1', 'send', 1, 1)).toBe(true);
    expect(limiter.take('s2', 'send', 1, 1)).toBe(false);
  });
});
