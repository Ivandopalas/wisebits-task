import type { StoryCreatedEvent, StoryDto, StoryFeedItem, StoryPlaybackDto } from '@chat/shared';
import { writable, type Readable } from 'svelte/store';
import { api, ApiRequestError, errorMessage, parse } from '../api/http.js';
import { auth } from './auth.js';

export interface StoriesState {
  feed: StoryFeedItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}

export interface StoriesApi {
  feed(): Promise<StoryFeedItem[]>;
  playback(storyId: string): Promise<StoryPlaybackDto>;
  markViewed(storyId: string): Promise<void>;
  remove(storyId: string): Promise<void>;
}

export interface StoriesStore extends Readable<StoriesState> {
  load(): Promise<void>;
  /** Puts an announced story into the feed; the server is not asked for anything. */
  add(event: StoryCreatedEvent, viewerId: string): void;
  /** A fresh link to play a story with, asked for each time it is opened. */
  videoUrl(storyId: string): Promise<string>;
  markViewed(storyId: string): void;
  /** Drops a story locally (deleted by its author, here or elsewhere). */
  remove(storyId: string): void;
  deleteOwn(storyId: string): Promise<void>;
  reset(): void;
}

const initial = (): StoriesState => ({ feed: [], status: 'idle', error: null });

type FeedChange = (feed: StoryFeedItem[]) => StoryFeedItem[];

function withoutStory(feed: StoryFeedItem[], storyId: string): StoryFeedItem[] {
  return feed
    .map((item) => {
      const stories = item.stories.filter((s) => s.id !== storyId);
      return { ...item, stories, hasUnseen: stories.some((s) => !s.viewed) };
    })
    .filter((item) => item.stories.length > 0);
}

/** Puts the story where the server would: my own first, then the newest with something unseen. */
function withStory(
  feed: StoryFeedItem[],
  { story, author }: StoryCreatedEvent,
  viewerId: string,
): StoryFeedItem[] {
  const existing = feed.find((item) => item.author.id === author.id);
  if (existing?.stories.some((s) => s.id === story.id)) {
    return feed;
  }
  const own = author.id === viewerId;
  const item: StoryFeedItem = {
    author,
    stories: [...(existing?.stories ?? []), { ...story, viewed: own }],
    hasUnseen: !own,
    latestAt: story.createdAt,
  };
  const others = feed.filter((other) => other !== existing);
  return others.toSpliced(!own && others[0]?.author.id === viewerId ? 1 : 0, 0, item);
}

export function createStoriesStore(client: StoriesApi): StoriesStore {
  const state = writable<StoriesState>(initial());
  let loading: Promise<void> | null = null;
  // A loaded feed replaces the current one and may have been read before these happened.
  let changesDuringLoad: FeedChange[] = [];

  const change = (apply: FeedChange) => {
    if (loading) {
      changesDuringLoad.push(apply);
    }
    state.update((s) => ({ ...s, feed: apply(s.feed) }));
  };

  const store: StoriesStore = {
    subscribe: state.subscribe,

    load() {
      loading ??= (async () => {
        state.update((s) => ({ ...s, status: s.feed.length ? s.status : 'loading', error: null }));
        try {
          const loaded = await client.feed();
          const feed = changesDuringLoad.reduce((current, apply) => apply(current), loaded);
          state.set({ feed, status: 'ready', error: null });
        } catch (error) {
          state.update((s) => ({
            ...s,
            status: s.feed.length ? 'ready' : 'error',
            error: errorMessage(error),
          }));
        }
      })().finally(() => {
        loading = null;
        changesDuringLoad = [];
      });
      return loading;
    },

    add(event, viewerId) {
      change((feed) => withStory(feed, event, viewerId));
    },

    async videoUrl(storyId) {
      try {
        return (await client.playback(storyId)).videoUrl;
      } catch (error) {
        // Expired or deleted since the feed was loaded.
        if (error instanceof ApiRequestError && error.status === 404) {
          store.remove(storyId);
        }
        throw error;
      }
    },

    markViewed(storyId) {
      change((feed) =>
        feed.map((item) => {
          const stories = item.stories.map((story) =>
            story.id === storyId ? { ...story, viewed: true } : story,
          );
          return { ...item, stories, hasUnseen: stories.some((story) => !story.viewed) };
        }),
      );
      void client.markViewed(storyId).catch(() => undefined);
    },

    remove(storyId) {
      change((feed) => withoutStory(feed, storyId));
    },

    async deleteOwn(storyId) {
      await client.remove(storyId);
      store.remove(storyId);
    },

    reset() {
      state.set(initial());
    },
  };
  return store;
}

export const stories = createStoriesStore({
  feed: () => api<StoryFeedItem[]>('/stories/feed'),
  playback: (storyId) => api<StoryPlaybackDto>(`/stories/${storyId}/playback`),
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
  return parse<StoryDto>(response);
}
