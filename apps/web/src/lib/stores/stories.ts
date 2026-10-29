import type { StoryDto, StoryFeedItem } from '@chat/shared';
import { writable, type Readable } from 'svelte/store';
import { api, ApiRequestError, errorMessage, parse } from '../api/http.js';
import { auth } from './auth.js';

export interface StoriesState {
  feed: StoryFeedItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  loadedAt: number;
}

export interface StoriesApi {
  feed(): Promise<StoryFeedItem[]>;
  markViewed(storyId: string): Promise<void>;
  remove(storyId: string): Promise<void>;
}

export interface StoriesStore extends Readable<StoriesState> {
  load(): Promise<void>;
  /** A reload a little later, merged with any others asked for in the meantime. */
  reloadSoon(): void;
  markViewed(storyId: string): void;
  /** Drops a story locally (deleted by its author, here or elsewhere). */
  remove(storyId: string): void;
  deleteOwn(storyId: string): Promise<void>;
  reset(): void;
}

const initial = (): StoriesState => ({ feed: [], status: 'idle', error: null, loadedAt: 0 });

// A new story is announced to everyone online at once. Reloading at a random moment within
// this window spreads their feed requests instead of having them all arrive together.
export const RELOAD_SPREAD_MS = 2000;

function withoutStory(feed: StoryFeedItem[], storyId: string): StoryFeedItem[] {
  return feed
    .map((item) => ({ ...item, stories: item.stories.filter((s) => s.id !== storyId) }))
    .filter((item) => item.stories.length > 0);
}

export function createStoriesStore(client: StoriesApi): StoriesStore {
  const state = writable<StoriesState>(initial());
  let loading: Promise<void> | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;

  const store: StoriesStore = {
    subscribe: state.subscribe,

    load() {
      loading ??= (async () => {
        state.update((s) => ({ ...s, status: s.feed.length ? s.status : 'loading', error: null }));
        try {
          const feed = await client.feed();
          state.set({ feed, status: 'ready', error: null, loadedAt: Date.now() });
        } catch (error) {
          state.update((s) => ({
            ...s,
            status: s.feed.length ? 'ready' : 'error',
            error: errorMessage(error),
          }));
        }
      })().finally(() => {
        loading = null;
      });
      return loading;
    },

    reloadSoon() {
      reloadTimer ??= setTimeout(() => {
        reloadTimer = undefined;
        void store.load();
      }, Math.random() * RELOAD_SPREAD_MS);
    },

    markViewed(storyId) {
      state.update((s) => ({
        ...s,
        feed: s.feed.map((item) => {
          const stories = item.stories.map((story) =>
            story.id === storyId ? { ...story, viewed: true } : story,
          );
          return { ...item, stories, hasUnseen: stories.some((story) => !story.viewed) };
        }),
      }));
      void client.markViewed(storyId).catch(() => undefined);
    },

    remove(storyId) {
      state.update((s) => ({ ...s, feed: withoutStory(s.feed, storyId) }));
    },

    async deleteOwn(storyId) {
      await client.remove(storyId);
      state.update((s) => ({ ...s, feed: withoutStory(s.feed, storyId) }));
    },

    reset() {
      clearTimeout(reloadTimer);
      reloadTimer = undefined;
      state.set(initial());
    },
  };
  return store;
}

export const stories = createStoriesStore({
  feed: () => api<StoryFeedItem[]>('/stories/feed'),
  markViewed: (storyId) => api<void>(`/stories/${storyId}/view`, { method: 'POST' }),
  remove: (storyId) => api<void>(`/stories/${storyId}`, { method: 'DELETE' }),
});

/**
 * Upload with progress: fetch cannot report upload progress, XMLHttpRequest can.
 * Retries once with a refreshed token if the access token expired mid-way.
 */
export async function uploadStory(
  video: Blob,
  durationMs: number,
  onProgress: (fraction: number) => void,
): Promise<StoryDto> {
  const attempt = (token: string | null) =>
    new Promise<Response>((resolve, reject) => {
      const form = new FormData();
      form.append('durationMs', String(Math.round(durationMs)));
      form.append('video', video, video.type.includes('mp4') ? 'story.mp4' : 'story.webm');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/stories');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded / event.total);
        }
      };
      xhr.onload = () => resolve(new Response(xhr.responseText || null, { status: xhr.status }));
      xhr.onerror = () =>
        reject(
          new ApiRequestError({
            statusCode: 0,
            error: 'Network Error',
            message: 'Upload failed. Check your connection.',
          }),
        );
      xhr.send(form);
    });

  let response = await attempt(await auth.freshToken());
  if (response.status === 401) {
    response = await attempt(await auth.refresh());
  }
  const story = await parse<StoryDto>(response);
  void stories.load();
  return story;
}
