import type { AckResponse, MessageDto, MessagesPage, WsSendMessagePayload } from '@chat/shared';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessagesStore, GAP_WAIT_MS, type MessagesTransport } from './messages.js';

vi.mock('../socket/client.js', () => ({ request: vi.fn() }));
vi.mock('./auth.js', () => ({ auth: { subscribe: () => () => undefined } }));

const CONVERSATION = 'c1';
const ME = 'me';

function message(seq: number, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: `m${seq}`,
    conversationId: CONVERSATION,
    seq,
    senderId: 'peer',
    text: `message ${seq}`,
    clientMessageId: `client-${seq}`,
    createdAt: new Date(2026, 9, 28, 12, seq).toISOString(),
    ...overrides,
  };
}

function setup(pages: MessagesPage[] = [{ items: [message(1), message(2)], hasMore: false }]) {
  const sent: WsSendMessagePayload[] = [];
  let reply: (payload: WsSendMessagePayload) => Promise<AckResponse<MessageDto>> = async (p) => ({
    ok: true,
    data: message(3, { senderId: ME, text: p.text, clientMessageId: p.clientMessageId }),
  });
  const transport: MessagesTransport = {
    fetchPage: vi.fn(async () => pages.shift() ?? { items: [], hasMore: false }),
    send: (payload) => {
      sent.push(payload);
      return reply(payload);
    },
  };
  const store = createMessagesStore(transport, () => ME);
  return {
    store,
    transport,
    sent,
    replyWith: (fn: typeof reply) => (reply = fn),
    items: () => get(store)[CONVERSATION]!.items,
  };
}

describe('messages store', () => {
  it('loads the latest page into a ready thread', async () => {
    const { store, items } = setup();
    await store.loadLatest(CONVERSATION);
    expect(get(store)[CONVERSATION]!.status).toBe('ready');
    expect(items().map((m) => m.seq)).toEqual([1, 2]);
  });

  it('shows a sent message immediately, then swaps in the confirmed copy', async () => {
    const { store, items, replyWith } = setup();
    await store.loadLatest(CONVERSATION);

    let confirm!: (ack: AckResponse<MessageDto>) => void;
    replyWith(() => new Promise((resolve) => (confirm = resolve)));
    const sending = store.send(CONVERSATION, 'hello');

    expect(items().at(-1)).toMatchObject({ text: 'hello', status: 'sending', seq: null });
    const { clientMessageId } = items().at(-1)!;
    confirm({ ok: true, data: message(3, { senderId: ME, text: 'hello', clientMessageId }) });
    await sending;

    expect(items()).toHaveLength(3);
    expect(items().at(-1)).toMatchObject({ seq: 3, status: 'sent', key: clientMessageId });
  });

  it('does not duplicate when the socket echo arrives before the ack', async () => {
    const { store, items, replyWith } = setup();
    await store.loadLatest(CONVERSATION);

    replyWith(async (payload) => {
      const echoed = message(3, {
        senderId: ME,
        text: payload.text,
        clientMessageId: payload.clientMessageId,
      });
      store.receive(echoed);
      return { ok: true, data: echoed };
    });
    await store.send(CONVERSATION, 'hi');

    expect(items().map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('marks a message failed and retries it with the same client id', async () => {
    const { store, items, sent, replyWith } = setup();
    await store.loadLatest(CONVERSATION);

    replyWith(() => Promise.reject(new Error('timeout')));
    await store.send(CONVERSATION, 'flaky');
    expect(items().at(-1)).toMatchObject({ status: 'failed', retryable: true });

    replyWith(async (payload) => ({
      ok: true,
      data: message(3, {
        senderId: ME,
        text: payload.text,
        clientMessageId: payload.clientMessageId,
      }),
    }));
    await store.retryFailed();

    expect(sent).toHaveLength(2);
    expect(sent[0]!.clientMessageId).toBe(sent[1]!.clientMessageId);
    expect(items().at(-1)).toMatchObject({ status: 'sent', seq: 3 });
  });

  it('re-sends a long queue in order without tripping the rate limit for good', async () => {
    vi.useFakeTimers();
    try {
      const { store, items, sent, replyWith } = setup();
      await store.loadLatest(CONVERSATION);
      replyWith(async () => {
        throw new Error('offline');
      });
      for (let i = 1; i <= 14; i += 1) {
        await store.send(CONVERSATION, `queued ${i}`);
      }
      sent.length = 0;

      // The gateway's limit: 10 sends per second per socket.
      let windowStart = Date.now();
      let inWindow = 0;
      let seq = 2;
      replyWith(async (p) => {
        if (Date.now() - windowStart >= 1000) {
          windowStart = Date.now();
          inWindow = 0;
        }
        inWindow += 1;
        if (inWindow > 10) {
          return {
            ok: false,
            error: { statusCode: 429, error: 'Too Many Requests', message: 'slow down' },
          };
        }
        seq += 1;
        return { ok: true, data: message(seq, { ...p, senderId: ME }) };
      });

      const retrying = store.retryFailed();
      await vi.advanceTimersByTimeAsync(5000);
      await retrying;

      expect(items().filter((m) => m.status !== 'sent')).toEqual([]);
      const delivered = [...new Set(sent.map((p) => p.text))];
      expect(delivered).toEqual(Array.from({ length: 14 }, (_, i) => `queued ${i + 1}`));
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-retry a message the server rejected as invalid', async () => {
    const { store, items, sent, replyWith } = setup();
    await store.loadLatest(CONVERSATION);
    replyWith(async () => ({
      ok: false,
      error: { statusCode: 403, error: 'Forbidden', message: 'Not a participant' },
    }));
    await store.send(CONVERSATION, 'nope');
    await store.retryFailed();

    expect(sent).toHaveLength(1);
    expect(items().at(-1)).toMatchObject({
      status: 'failed',
      retryable: false,
      error: 'Not a participant',
    });
  });

  it('keeps messages ordered by seq whatever order they arrive in', async () => {
    const { store, items } = setup();
    await store.loadLatest(CONVERSATION);
    store.receive(message(5));
    store.receive(message(4));
    store.receive(message(5));
    expect(items().map((m) => m.seq)).toEqual([1, 2, 4, 5]);
  });

  it('prepends older pages and catches up from the last confirmed seq', async () => {
    const { store, transport, items } = setup([
      { items: [message(3), message(4)], hasMore: true },
      { items: [message(1), message(2)], hasMore: false },
      { items: [message(5)], hasMore: false },
    ]);
    await store.loadLatest(CONVERSATION);
    await store.loadOlder(CONVERSATION);
    expect(transport.fetchPage).toHaveBeenLastCalledWith(CONVERSATION, { before: 3, limit: 30 });
    expect(get(store)[CONVERSATION]!.hasMore).toBe(false);

    await store.catchUp(CONVERSATION);
    expect(transport.fetchPage).toHaveBeenLastCalledWith(CONVERSATION, { after: 4, limit: 100 });
    expect(items().map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('catches up from the first hole, not from the newest message', async () => {
    const { store, transport, items } = setup([
      { items: [message(1), message(2)], hasMore: false },
      { items: [message(3), message(4), message(5)], hasMore: false },
    ]);
    await store.loadLatest(CONVERSATION);
    store.receive(message(5));

    await store.catchUp(CONVERSATION);

    expect(transport.fetchPage).toHaveBeenLastCalledWith(CONVERSATION, { after: 2, limit: 100 });
    expect(items().map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('pages through everything missed, however much that is', async () => {
    const hundredFrom = (seq: number) => Array.from({ length: 100 }, (_, i) => message(seq + i));
    const { store, transport, items } = setup([
      { items: [message(1), message(2)], hasMore: false },
      { items: hundredFrom(3), hasMore: true },
      { items: hundredFrom(103), hasMore: true },
      { items: [message(203)], hasMore: false },
    ]);
    await store.loadLatest(CONVERSATION);

    await store.catchUp(CONVERSATION);

    expect(items().map((m) => m.seq)).toEqual(Array.from({ length: 203 }, (_, i) => i + 1));
    expect(vi.mocked(transport.fetchPage).mock.calls.map(([, query]) => query.after)).toEqual([
      undefined,
      2,
      102,
      202,
    ]);
  });

  describe('a message that skips ahead in seq', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('brings in what it skipped over', async () => {
      const { store, transport, items } = setup([
        { items: [message(1), message(2)], hasMore: false },
        { items: [message(3), message(4), message(5)], hasMore: false },
      ]);
      await store.loadLatest(CONVERSATION);

      store.receive(message(5));
      await vi.advanceTimersByTimeAsync(GAP_WAIT_MS);

      expect(transport.fetchPage).toHaveBeenLastCalledWith(CONVERSATION, { after: 2, limit: 100 });
      expect(items().map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    });

    it('gives one that is merely late a moment to arrive', async () => {
      const { store, transport } = setup();
      await store.loadLatest(CONVERSATION);

      store.receive(message(4));
      store.receive(message(3));
      await vi.advanceTimersByTimeAsync(GAP_WAIT_MS);

      expect(transport.fetchPage).toHaveBeenCalledTimes(1);
    });

    it('is noticed in the confirmation of my own message too', async () => {
      const { store, transport, replyWith } = setup();
      await store.loadLatest(CONVERSATION);
      replyWith(async (p) => ({ ok: true, data: message(4, { ...p, senderId: ME }) }));

      await store.send(CONVERSATION, 'hello');
      await vi.advanceTimersByTimeAsync(GAP_WAIT_MS);

      expect(transport.fetchPage).toHaveBeenLastCalledWith(CONVERSATION, { after: 2, limit: 100 });
    });

    it('is noticed in a conversation that was empty', async () => {
      const { store, transport } = setup([{ items: [], hasMore: false }]);
      await store.loadLatest(CONVERSATION);

      store.receive(message(2));
      await vi.advanceTimersByTimeAsync(GAP_WAIT_MS);

      expect(transport.fetchPage).toHaveBeenLastCalledWith(CONVERSATION, { after: 0, limit: 100 });
    });

    it('does not take history that is not loaded yet for a hole', async () => {
      const { store, transport } = setup([{ items: [message(10), message(11)], hasMore: true }]);
      await store.loadLatest(CONVERSATION);

      store.receive(message(12));
      await vi.advanceTimersByTimeAsync(GAP_WAIT_MS);

      expect(transport.fetchPage).toHaveBeenCalledTimes(1);
    });
  });
});
