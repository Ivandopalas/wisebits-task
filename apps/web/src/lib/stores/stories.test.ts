import type { StoryDto, StoryFeedItem } from '@chat/shared';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/http.js';
import { createStoriesStore, RELOAD_SPREAD_MS } from './stories.js';

const user = (id: string) => ({ id, username: id, createdAt: '2026-01-01T00:00:00.000Z' });

const story = (id: string, authorId: string, createdAt = '2026-10-30T10:00:00.000Z'): StoryDto => ({
  id,
  authorId,
  mimeType: 'video/webm',
  durationMs: 5000,
  sizeBytes: 1000,
  createdAt,
  expiresAt: '2026-10-31T10:00:00.000Z',
  viewed: false,
});

const feedItem = (...stories: StoryDto[]): StoryFeedItem => ({
  author: user(stories[0]!.authorId),
  stories,
  hasUnseen: stories.some((s) => !s.viewed),
  latestAt: stories.at(-1)!.createdAt,
});

const storyIds = (state: { feed: StoryFeedItem[] }) =>
  state.feed.map((item) => [item.author.id, item.stories.map((s) => s.id)]);

describe('stories store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(feed: StoryFeedItem[] = []) {
    const client = {
      feed: vi.fn(async () => feed),
      playback: vi.fn(async (id: string) => ({ videoUrl: `/video/${id}` })),
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

  describe('videoUrl', () => {
    it('forgets a story the server no longer has', async () => {
      const { store, client } = setup([feedItem(story('gone', 'bob'), story('live', 'bob'))]);
      await store.load();
      client.playback.mockRejectedValueOnce(
        new ApiRequestError({ statusCode: 404, error: 'Not Found', message: 'Story not found' }),
      );

      await expect(store.videoUrl('gone')).rejects.toThrow('Story not found');
      expect(storyIds(get(store))).toEqual([['bob', ['live']]]);
    });

    it('keeps a story when the link only failed to arrive', async () => {
      const { store, client } = setup([feedItem(story('s1', 'bob'))]);
      await store.load();
      client.playback.mockRejectedValueOnce(new Error('network'));

      await expect(store.videoUrl('s1')).rejects.toThrow('network');
      expect(storyIds(get(store))).toEqual([['bob', ['s1']]]);
    });
  });
});
