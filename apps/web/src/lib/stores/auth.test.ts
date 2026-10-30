import type { AuthResponse } from '@chat/shared';
import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { createAuthStore } from './auth.js';

const session = (token: string): AuthResponse => ({
  accessToken: token,
  expiresIn: 900,
  user: { id: 'u1', username: 'alice', email: 'alice@example.com', createdAt: '' },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Web Locks in miniature: tasks under one name run one after another, in order. */
function lockManager() {
  const tails = new Map<string, Promise<unknown>>();
  const request = (name: string, task: () => Promise<unknown>) => {
    const run = (tails.get(name) ?? Promise.resolve()).then(task);
    tails.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  };
  return { request } as Pick<LockManager, 'request'>;
}

describe('auth store', () => {
  it('restores the session from the refresh cookie', async () => {
    const fetch = vi.fn(async () => json(200, session('t1')));
    const auth = createAuthStore({ fetch });
    expect(await auth.init()).toBe('authenticated');
    expect(get(auth).user?.username).toBe('alice');
    expect(auth.token()).toBe('t1');
  });

  it('reports anonymous when there is no session', async () => {
    const auth = createAuthStore({
      fetch: async () => json(401, { statusCode: 401, message: 'x' }),
    });
    expect(await auth.init()).toBe('anonymous');
    expect(get(auth).status).toBe('anonymous');
  });

  it('skips the refresh call when there is no session cookie', async () => {
    const fetch = vi.fn(async () => json(200, session('t1')));
    const auth = createAuthStore({ fetch, hasSessionHint: () => false });
    expect(await auth.init()).toBe('anonymous');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shares one refresh between concurrent callers', async () => {
    let calls = 0;
    const fetch = vi.fn(async () => json(200, session(`t${++calls}`)));
    const auth = createAuthStore({ fetch });
    const tokens = await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(tokens).toEqual(['t1', 't1', 't1']);
  });

  it('queues the refreshes of two tabs, which share one refresh cookie', async () => {
    let inFlight = 0;
    let overlapped = false;
    let calls = 0;
    const fetch = vi.fn(async () => {
      overlapped ||= inFlight > 0;
      inFlight += 1;
      await new Promise((resolve) => setTimeout(resolve));
      inFlight -= 1;
      return json(200, session(`t${++calls}`));
    });
    const locks = lockManager();
    const tabs = [createAuthStore({ fetch, locks }), createAuthStore({ fetch, locks })];

    const tokens = await Promise.all(tabs.map((tab) => tab.refresh()));

    expect(overlapped).toBe(false);
    expect(tokens).toEqual(['t1', 't2']);
  });

  it('refreshes only when the access token is about to expire', async () => {
    let now = 0;
    let calls = 0;
    const auth = createAuthStore({
      fetch: async () => json(200, session(`t${++calls}`)),
      now: () => now,
    });
    await auth.refresh();
    now = 60_000;
    expect(await auth.freshToken()).toBe('t1');
    now = 900_000 - 10_000;
    expect(await auth.freshToken()).toBe('t2');
  });

  it('signs out every tab', async () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const channel = {
      postMessage: vi.fn(),
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) =>
        listeners.push(listener),
    } as unknown as BroadcastChannel;
    const auth = createAuthStore({ fetch: async () => json(200, session('t1')), channel });
    await auth.init();

    listeners.forEach((listener) => listener(new MessageEvent('message', { data: 'logout' })));
    expect(get(auth).status).toBe('anonymous');
    expect(auth.token()).toBeNull();
  });
});
