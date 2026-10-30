import type { StoryDto, StoryFeedItem } from '@chat/shared';
import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/http.js';
import { createStoriesStore } from './stories.js';

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

const announcement = (id: string, authorId: string) => ({
  story: story(id, authorId, '2026-10-30T12:00:00.000Z'),
  author: user(authorId),
});

const storyIds = (state: { feed: StoryFeedItem[] }) =>
  state.feed.map((item) => [item.author.id, item.stories.map((s) => s.id)]);

describe('stories store', () => {
  function setup(feed: StoryFeedItem[] = []) {
    const client = {
      feed: vi.fn(async () => feed),
      playback: vi.fn(async (id: string) => ({ videoUrl: `/video/${id}` })),
      markViewed: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    return { store: createStoriesStore(client), client };
  }

  describe('a new story', () => {
    it('joins the feed without a request to the server', async () => {
      const { store, client } = setup([feedItem(story('old', 'bob'))]);
      await store.load();

      store.add(announcement('new', 'bob'), 'me');

      expect(client.feed).toHaveBeenCalledTimes(1);
      expect(storyIds(get(store))).toEqual([['bob', ['old', 'new']]]);
      expect(get(store).feed[0]).toMatchObject({
        hasUnseen: true,
        latestAt: '2026-10-30T12:00:00.000Z',
      });
    });

    it('brings its author to the front, behind my own stories', async () => {
      const { store } = setup([
        feedItem({ ...story('mine', 'me'), viewed: true }),
        feedItem(story('s1', 'bob')),
        feedItem(story('s2', 'carol')),
      ]);
      await store.load();

      store.add(announcement('s3', 'carol'), 'me');
      store.add(announcement('s4', 'dave'), 'me');

      expect(get(store).feed.map((item) => item.author.id)).toEqual(['me', 'dave', 'carol', 'bob']);
    });

    it('takes the first place and counts as seen when it is my own', async () => {
      const { store } = setup([feedItem(story('s1', 'bob'))]);
      await store.load();

      store.add(announcement('mine', 'me'), 'me');

      expect(storyIds(get(store))).toEqual([
        ['me', ['mine']],
        ['bob', ['s1']],
      ]);
      expect(get(store).feed[0]).toMatchObject({
        hasUnseen: false,
        stories: [{ viewed: true }],
      });
    });

    it('is added once however many times it is announced', async () => {
      const { store } = setup([feedItem(story('s1', 'bob'))]);
      await store.load();

      store.add(announcement('s1', 'bob'), 'me');

      expect(storyIds(get(store))).toEqual([['bob', ['s1']]]);
    });
  });

  describe('while the feed is on its way', () => {
    function setupLoading() {
      const { store, client } = setup();
      let respond!: (feed: StoryFeedItem[]) => void;
      client.feed.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)));
      return { store, loaded: store.load(), respond };
    }

    it('keeps a story announced after the server read the feed', async () => {
      const { store, loaded, respond } = setupLoading();

      store.add(announcement('new', 'bob'), 'me');
      respond([feedItem(story('old', 'carol'))]);
      await loaded;

      expect(storyIds(get(store))).toEqual([
        ['bob', ['new']],
        ['carol', ['old']],
      ]);
    });

    it('does not bring back a story deleted in the meantime', async () => {
      const { store, loaded, respond } = setupLoading();

      store.remove('s1');
      respond([feedItem(story('s1', 'bob'), story('s2', 'bob'))]);
      await loaded;

      expect(storyIds(get(store))).toEqual([['bob', ['s2']]]);
    });

    it('does not show again as unseen a story watched in the meantime', async () => {
      const { store, loaded, respond } = setupLoading();

      store.markViewed('s1');
      respond([feedItem(story('s1', 'bob'))]);
      await loaded;

      expect(get(store).feed[0]?.hasUnseen).toBe(false);
    });
  });

  it('stops counting a deleted story as unseen', async () => {
    const { store } = setup([
      feedItem({ ...story('seen', 'bob'), viewed: true }, story('unseen', 'bob')),
    ]);
    await store.load();

    store.remove('unseen');

    expect(get(store).feed[0]?.hasUnseen).toBe(false);
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
