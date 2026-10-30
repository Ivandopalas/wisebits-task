import type { ConversationDto, Page } from '@chat/shared';
import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { createConversationsStore } from './conversations.js';

function conversation(
  id: string,
  minute: number,
  overrides: Partial<ConversationDto> = {},
): ConversationDto {
  const at = new Date(2026, 9, 28, 12, minute).toISOString();
  return {
    id,
    peer: { id: `peer-${id}`, username: `peer${id}`, createdAt: at },
    lastMessage: { id: `m-${id}`, seq: 1, senderId: `peer-${id}`, text: 'hi', createdAt: at },
    unreadCount: 0,
    peerLastReadSeq: 0,
    lastActivityAt: at,
    createdAt: at,
    ...overrides,
  };
}

function setup(items: ConversationDto[] = []) {
  const client = {
    list: vi.fn(async (_cursor?: string): Promise<Page<ConversationDto>> => ({
      items,
      nextCursor: null,
    })),
    get: vi.fn(async (id: string) => conversation(id, 0)),
    open: vi.fn(async (userId: string) => conversation(`new-${userId}`, 59)),
  };
  return { store: createConversationsStore(client), client };
}

describe('conversations store', () => {
  it('sorts by latest activity', async () => {
    const { store } = setup([conversation('a', 1), conversation('b', 3), conversation('c', 2)]);
    await store.load();
    expect(get(store).items.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('moves a conversation to the top when a new message arrives', async () => {
    const { store } = setup([conversation('a', 1), conversation('b', 3)]);
    await store.load();
    store.upsert(
      conversation('a', 10, {
        lastMessage: { id: 'm2', seq: 2, senderId: 'peer-a', text: 'new', createdAt: '' },
        unreadCount: 1,
      }),
    );
    expect(get(store).items.map((c) => [c.id, c.unreadCount])).toEqual([
      ['a', 1],
      ['b', 0],
    ]);
  });

  it('ignores a stale copy of a conversation', async () => {
    const fresh = conversation('a', 5, {
      lastMessage: { id: 'm3', seq: 3, senderId: 'peer-a', text: 'latest', createdAt: '' },
    });
    const { store } = setup([fresh]);
    await store.load();
    store.upsert(conversation('a', 1));
    expect(get(store).items[0]!.lastMessage?.text).toBe('latest');
  });

  it('applies read receipts from the peer and from my other tabs', async () => {
    const { store } = setup([conversation('a', 1, { unreadCount: 2 })]);
    await store.load();

    store.applyRead({ conversationId: 'a', userId: 'peer-a', seq: 1 }, 'me');
    expect(get(store).items[0]!.peerLastReadSeq).toBe(1);

    store.applyRead({ conversationId: 'a', userId: 'me', seq: 1 }, 'me');
    expect(get(store).items[0]!.unreadCount).toBe(0);
  });

  it('keeps the unread count when my other tab has read only part of it', async () => {
    const lastMessage = { id: 'm3', seq: 3, senderId: 'peer-a', text: 'new', createdAt: '' };
    const { store } = setup([conversation('a', 1, { lastMessage, unreadCount: 2 })]);
    await store.load();

    store.applyRead({ conversationId: 'a', userId: 'me', seq: 2 }, 'me');
    expect(get(store).items[0]!.unreadCount).toBe(2);
  });

  it('fetches an unknown conversation once and reuses it', async () => {
    const { store, client } = setup();
    await store.load();
    await store.ensure('x');
    await store.ensure('x');
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('keeps a conversation opened directly when the list loads after it', async () => {
    // The peer started it and nobody has written yet, so the list does not include it.
    const { store, client } = setup([conversation('a', 1)]);
    let finishList!: () => void;
    client.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishList = () => resolve({ items: [conversation('a', 1)], nextCursor: null });
        }),
    );
    const loading = store.load();
    await store.ensure('empty');
    finishList();
    await loading;
    expect(get(store).items.map((c) => c.id)).toEqual(['a', 'empty']);

    // Every reconnect reloads the list; the open conversation must survive that too.
    await store.load();
    expect(get(store).items.map((c) => c.id)).toEqual(['a', 'empty']);
  });

  it('keeps older pages and their cursor when the first page reloads', async () => {
    const { store, client } = setup();
    client.list.mockImplementation(async (cursor?: string) =>
      cursor === 'page-2'
        ? { items: [conversation('c', 2), conversation('d', 1)], nextCursor: 'page-3' }
        : { items: [conversation('a', 4), conversation('b', 3)], nextCursor: 'page-2' },
    );
    await store.load();
    await store.loadMore();
    await store.load();
    expect(get(store)).toMatchObject({ nextCursor: 'page-3' });
    expect(get(store).items.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('takes fresh unread counts from a reload', async () => {
    const { store, client } = setup([conversation('a', 1, { unreadCount: 2 })]);
    await store.load();
    client.list.mockResolvedValueOnce({ items: [conversation('a', 1)], nextCursor: null });
    await store.load();
    expect(get(store).items[0]!.unreadCount).toBe(0);
  });

  it('keeps the list when a reload fails', async () => {
    const { store, client } = setup([conversation('a', 1)]);
    await store.load();
    client.list.mockRejectedValueOnce(new Error('offline'));
    await store.load();
    expect(get(store)).toMatchObject({ status: 'ready', items: [{ id: 'a' }] });
  });
});
