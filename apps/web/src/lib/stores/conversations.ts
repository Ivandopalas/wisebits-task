import type { ConversationDto, ConversationReadEvent, Page } from '@chat/shared';
import { derived, get, writable, type Readable } from 'svelte/store';
import { api, errorMessage } from '../api/http.js';

export interface ConversationsState {
  /** Most recently active first. */
  items: ConversationDto[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  nextCursor: string | null;
  loadingMore: boolean;
  /** Pages past the first were loaded: a reload of the first page must keep their cursor. */
  pagedBeyondFirst: boolean;
}

export interface ConversationsApi {
  list(cursor?: string): Promise<Page<ConversationDto>>;
  get(id: string): Promise<ConversationDto>;
  open(userId: string): Promise<ConversationDto>;
}

export interface ConversationsStore extends Readable<ConversationsState> {
  load(): Promise<void>;
  loadMore(): Promise<void>;
  ensure(id: string): Promise<ConversationDto>;
  open(userId: string): Promise<ConversationDto>;
  upsert(conversation: ConversationDto): void;
  /** Applies a read receipt; `myId` tells whether it came from me or from the peer. */
  applyRead(event: ConversationReadEvent, myId: string): void;
  clearUnread(id: string): void;
  reset(): void;
}

const initial = (): ConversationsState => ({
  items: [],
  status: 'idle',
  error: null,
  nextCursor: null,
  loadingMore: false,
  pagedBeyondFirst: false,
});

export function byActivity(a: ConversationDto, b: ConversationDto): number {
  return b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id);
}

/** Keeps the newer copy of each conversation: list pages and socket events can cross. */
function merge(items: ConversationDto[], incoming: ConversationDto[]): ConversationDto[] {
  const byId = new Map(items.map((c) => [c.id, c]));
  for (const conversation of incoming) {
    const existing = byId.get(conversation.id);
    const existingSeq = existing?.lastMessage?.seq ?? 0;
    const incomingSeq = conversation.lastMessage?.seq ?? 0;
    if (!existing || incomingSeq >= existingSeq) {
      byId.set(conversation.id, {
        ...conversation,
        peerLastReadSeq: Math.max(conversation.peerLastReadSeq, existing?.peerLastReadSeq ?? 0),
      });
    }
  }
  return [...byId.values()].sort(byActivity);
}

export function createConversationsStore(client: ConversationsApi): ConversationsStore {
  const state = writable<ConversationsState>(initial());

  function update(id: string, change: (c: ConversationDto) => ConversationDto) {
    state.update((s) => ({ ...s, items: s.items.map((c) => (c.id === id ? change(c) : c)) }));
  }

  return {
    subscribe: state.subscribe,

    async load() {
      state.update((s) => ({ ...s, status: s.items.length ? s.status : 'loading', error: null }));
      try {
        const page = await client.list();
        // Runs again after every reconnect. The first page only refreshes what it contains:
        // older pages, and conversations opened directly that the list does not show (an empty
        // one started by the peer), stay where they are.
        state.update((s) => ({
          ...s,
          items: merge(s.items, page.items),
          nextCursor: s.pagedBeyondFirst ? s.nextCursor : page.nextCursor,
          status: 'ready',
        }));
      } catch (error) {
        state.update((s) => ({
          ...s,
          status: s.items.length ? 'ready' : 'error',
          error: errorMessage(error),
        }));
      }
    },

    async loadMore() {
      const { nextCursor, loadingMore } = get(state);
      if (!nextCursor || loadingMore) {
        return;
      }
      state.update((s) => ({ ...s, loadingMore: true }));
      try {
        const page = await client.list(nextCursor);
        state.update((s) => ({
          ...s,
          items: merge(s.items, page.items),
          nextCursor: page.nextCursor,
          loadingMore: false,
          pagedBeyondFirst: true,
        }));
      } catch (error) {
        state.update((s) => ({ ...s, loadingMore: false, error: errorMessage(error) }));
      }
    },

    async ensure(id) {
      const known = get(state).items.find((c) => c.id === id);
      if (known) {
        return known;
      }
      const conversation = await client.get(id);
      state.update((s) => ({ ...s, items: merge(s.items, [conversation]) }));
      return conversation;
    },

    async open(userId) {
      const conversation = await client.open(userId);
      state.update((s) => ({ ...s, items: merge(s.items, [conversation]) }));
      return conversation;
    },

    upsert(conversation) {
      state.update((s) => ({ ...s, items: merge(s.items, [conversation]) }));
    },

    applyRead(event, myId) {
      update(event.conversationId, (c) =>
        event.userId === myId
          ? { ...c, unreadCount: event.seq >= (c.lastMessage?.seq ?? 0) ? 0 : c.unreadCount }
          : { ...c, peerLastReadSeq: Math.max(c.peerLastReadSeq, event.seq) },
      );
    },

    clearUnread(id) {
      update(id, (c) => ({ ...c, unreadCount: 0 }));
    },

    reset() {
      state.set(initial());
    },
  };
}

export const conversations = createConversationsStore({
  list: (cursor) => api<Page<ConversationDto>>('/conversations', { query: { cursor } }),
  get: (id) => api<ConversationDto>(`/conversations/${id}`),
  open: (userId) => api<ConversationDto>('/conversations', { method: 'POST', body: { userId } }),
});

export const totalUnread = derived(conversations, ($c) =>
  $c.items.reduce((sum, c) => sum + c.unreadCount, 0),
);
