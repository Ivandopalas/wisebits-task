import type {
  AckResponse,
  ListMessagesQuery,
  MessageDto,
  MessagesPage,
  WsSendMessagePayload,
} from '@chat/shared';
import { get, writable, type Readable } from 'svelte/store';
import { api, errorMessage } from '../api/http.js';
import { request } from '../socket/client.js';
import { uuid } from '../utils/uuid.js';
import { auth } from './auth.js';

export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  /** Stable list key: the client id survives the switch from optimistic to confirmed. */
  key: string;
  id: string | null;
  seq: number | null;
  conversationId: string;
  senderId: string;
  text: string;
  clientMessageId: string;
  createdAt: string;
  status: MessageStatus;
  error?: string;
  /** Failed for a reason that a retry can fix (network, rate limit, server error). */
  retryable?: boolean;
}

export interface Thread {
  items: ChatMessage[];
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  hasMore: boolean;
  loadingOlder: boolean;
}

export type MessagesState = Record<string, Thread>;

export interface MessagesTransport {
  fetchPage(conversationId: string, query: Partial<ListMessagesQuery>): Promise<MessagesPage>;
  /** Rejects when no ack arrives (disconnected, timed out). */
  send(payload: WsSendMessagePayload): Promise<AckResponse<MessageDto>>;
}

export interface MessagesStore extends Readable<MessagesState> {
  loadLatest(conversationId: string): Promise<void>;
  loadOlder(conversationId: string): Promise<void>;
  /** Fetches everything after the last confirmed message: used after a reconnect. */
  catchUp(conversationId: string): Promise<void>;
  receive(message: MessageDto): void;
  send(conversationId: string, text: string): Promise<void>;
  retry(conversationId: string, clientMessageId: string): Promise<void>;
  /** Re-sends every message that failed for a transient reason. */
  retryFailed(): Promise<void>;
  loadedConversationIds(): string[];
  reset(): void;
}

const PAGE_SIZE = 30;
/** The gateway accepts 10 sends a second per socket; a queue waits for the next window. */
const RATE_LIMIT_PAUSE_MS = 1000;
const RATE_LIMIT_RETRIES = 5;

function confirmed(message: MessageDto): ChatMessage {
  return { ...message, key: message.clientMessageId, status: 'sent' };
}

/** Confirmed messages in seq order, then the ones still on their way in the order they were typed. */
function order(items: ChatMessage[]): ChatMessage[] {
  const sent = items.filter((m) => m.seq !== null).sort((a, b) => a.seq! - b.seq!);
  const pending = items.filter((m) => m.seq === null);
  return [...sent, ...pending];
}

/** Merges server messages into a thread; a server copy replaces the optimistic one. */
function mergeMessages(items: ChatMessage[], incoming: MessageDto[]): ChatMessage[] {
  const byKey = new Map(items.map((m) => [m.key, m]));
  const seqs = new Set(items.map((m) => m.seq));
  for (const message of incoming) {
    if (seqs.has(message.seq) && !byKey.has(message.clientMessageId)) {
      continue;
    }
    byKey.set(message.clientMessageId, confirmed(message));
    seqs.add(message.seq);
  }
  return order([...byKey.values()]);
}

function lastSeq(thread: Thread | undefined): number {
  return thread?.items.reduce((max, m) => Math.max(max, m.seq ?? 0), 0) ?? 0;
}

export function createMessagesStore(
  transport: MessagesTransport,
  currentUserId: () => string | null,
): MessagesStore {
  const state = writable<MessagesState>({});
  let retrying: Promise<void> | null = null;

  function patch(conversationId: string, change: (thread: Thread) => Partial<Thread>) {
    state.update((s) => {
      const thread = s[conversationId];
      return thread ? { ...s, [conversationId]: { ...thread, ...change(thread) } } : s;
    });
  }

  function patchMessage(conversationId: string, key: string, change: Partial<ChatMessage>) {
    patch(conversationId, (t) => ({
      items: t.items.map((m) => (m.key === key ? { ...m, ...change } : m)),
    }));
  }

  /** Resolves with the status code of a rejection, or null once the message is in. */
  async function deliver(message: ChatMessage): Promise<number | null> {
    patchMessage(message.conversationId, message.key, { status: 'sending', error: undefined });
    try {
      const ack = await transport.send({
        conversationId: message.conversationId,
        text: message.text,
        clientMessageId: message.clientMessageId,
      });
      if (ack.ok) {
        patch(message.conversationId, (t) => ({ items: mergeMessages(t.items, [ack.data]) }));
        return null;
      }
      const transient = ack.error.statusCode === 429 || ack.error.statusCode >= 500;
      patchMessage(message.conversationId, message.key, {
        status: 'failed',
        error: ack.error.message,
        retryable: transient,
      });
      return ack.error.statusCode;
    } catch {
      patchMessage(message.conversationId, message.key, {
        status: 'failed',
        error: 'Not delivered',
        retryable: true,
      });
      return 0;
    }
  }

  async function catchUp(conversationId: string) {
    let after = lastSeq(get(state)[conversationId]);
    for (;;) {
      const page = await transport.fetchPage(conversationId, { after, limit: 100 });
      patch(conversationId, (t) => ({ items: mergeMessages(t.items, page.items) }));
      if (!page.hasMore || page.items.length === 0) {
        return;
      }
      after = page.items[page.items.length - 1]!.seq;
    }
  }

  return {
    subscribe: state.subscribe,

    async loadLatest(conversationId) {
      const existing = get(state)[conversationId];
      if (existing?.status === 'ready') {
        return catchUp(conversationId).catch(() => undefined);
      }
      state.update((s) => ({
        ...s,
        [conversationId]: {
          items: existing?.items ?? [],
          status: 'loading',
          error: null,
          hasMore: false,
          loadingOlder: false,
        },
      }));
      try {
        const page = await transport.fetchPage(conversationId, { limit: PAGE_SIZE });
        patch(conversationId, (t) => ({
          items: mergeMessages(t.items, page.items),
          hasMore: page.hasMore,
          status: 'ready',
        }));
      } catch (error) {
        patch(conversationId, () => ({ status: 'error', error: errorMessage(error) }));
      }
    },

    async loadOlder(conversationId) {
      const thread = get(state)[conversationId];
      if (!thread || !thread.hasMore || thread.loadingOlder) {
        return;
      }
      const before = thread.items.find((m) => m.seq !== null)?.seq;
      if (before === undefined || before === null) {
        return;
      }
      patch(conversationId, () => ({ loadingOlder: true }));
      try {
        const page = await transport.fetchPage(conversationId, { before, limit: PAGE_SIZE });
        patch(conversationId, (t) => ({
          items: mergeMessages(t.items, page.items),
          hasMore: page.hasMore,
          loadingOlder: false,
        }));
      } catch (error) {
        patch(conversationId, () => ({ loadingOlder: false, error: errorMessage(error) }));
      }
    },

    catchUp,

    receive(message) {
      patch(message.conversationId, (t) => ({ items: mergeMessages(t.items, [message]) }));
    },

    async send(conversationId, text) {
      const senderId = currentUserId();
      if (!senderId || !get(state)[conversationId]) {
        return;
      }
      const clientMessageId = uuid();
      const message: ChatMessage = {
        key: clientMessageId,
        id: null,
        seq: null,
        conversationId,
        senderId,
        text,
        clientMessageId,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      patch(conversationId, (t) => ({ items: order([...t.items, message]) }));
      await deliver(message);
    },

    async retry(conversationId, clientMessageId) {
      const message = get(state)[conversationId]?.items.find((m) => m.key === clientMessageId);
      if (message && message.status === 'failed') {
        await deliver(message);
      }
    },

    retryFailed() {
      // One pass at a time: a reconnect in the middle of one must not start a second.
      retrying ??= (async () => {
        const failed = Object.values(get(state))
          .flatMap((t) => t.items)
          .filter((m) => m.status === 'failed' && m.retryable)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        // One message at a time, in the order they were typed: a long queue sent all at once
        // would run into the rate limit and fail again.
        for (const message of failed) {
          for (let attempt = 1; (await deliver(message)) === 429; attempt += 1) {
            if (attempt === RATE_LIMIT_RETRIES) break;
            await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_PAUSE_MS));
          }
        }
      })().finally(() => {
        retrying = null;
      });
      return retrying;
    },

    loadedConversationIds: () =>
      Object.entries(get(state))
        .filter(([, t]) => t.status === 'ready')
        .map(([id]) => id),

    reset() {
      state.set({});
    },
  };
}

export const messages = createMessagesStore(
  {
    fetchPage: (conversationId, query) =>
      api<MessagesPage>(`/conversations/${conversationId}/messages`, { query }),
    send: (payload) => request('message:send', payload),
  },
  () => get(auth).user?.id ?? null,
);
