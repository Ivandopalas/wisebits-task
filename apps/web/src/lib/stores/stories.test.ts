import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStoriesStore, RELOAD_SPREAD_MS } from './stories.js';

describe('stories store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const client = {
      feed: vi.fn(async () => []),
      markViewed: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    return { store: createStoriesStore(client), client };
  }

  it('merges a burst of announcements into one reload within the spread window', async () => {
    const { store, client } = setup();
    store.reloadSoon();
    store.reloadSoon();
    store.reloadSoon();
    expect(client.feed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RELOAD_SPREAD_MS);
    expect(client.feed).toHaveBeenCalledTimes(1);

    store.reloadSoon();
    await vi.advanceTimersByTimeAsync(RELOAD_SPREAD_MS);
    expect(client.feed).toHaveBeenCalledTimes(2);
  });

  it('spreads reloads over the window rather than firing them all at once', async () => {
    const { store, client } = setup();
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    store.reloadSoon();
    await vi.advanceTimersByTimeAsync(RELOAD_SPREAD_MS * 0.7);
    expect(client.feed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RELOAD_SPREAD_MS * 0.1);
    expect(client.feed).toHaveBeenCalledTimes(1);
  });

  it('drops a pending reload on sign out', async () => {
    const { store, client } = setup();
    store.reloadSoon();
    store.reset();
    await vi.advanceTimersByTimeAsync(RELOAD_SPREAD_MS);
    expect(client.feed).not.toHaveBeenCalled();
  });
});
