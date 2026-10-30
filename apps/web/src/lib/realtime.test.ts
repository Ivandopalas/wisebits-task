import type { ConversationDto, MessageDto } from '@chat/shared';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const socket = vi.hoisted(() => ({
  connected: true,
  on: vi.fn(),
  open: vi.fn(),
  request: vi.fn(),
  current: null as unknown,
}));

vi.mock('./socket/client.js', async () => {
  const { writable } = await import('svelte/store');
  return {
    connection: writable('idle'),
    openSocket: socket.open,
    closeSocket: vi.fn(),
    currentSocket: () => socket.current ?? socket,
    request: socket.request,
  };
});

const { PRESENCE_RESYNC_MS, sendTyping, startRealtime, stopRealtime } =
  await import('./realtime.js');
const { conversations } = await import('./stores/conversations.js');
const { presence } = await import('./stores/presence.js');
const { stories } = await import('./stores/stories.js');
const { typing } = await import('./stores/typing.js');

const peer = { id: 'peer-1', username: 'carol', createdAt: '2026-10-29T10:00:00.000Z' };
const conversation: ConversationDto = {
  id: 'c1',
  peer,
  lastMessage: null,
  unreadCount: 0,
  peerLastReadSeq: 0,
  lastActivityAt: peer.createdAt,
  createdAt: peer.createdAt,
};

const message: MessageDto = {
  id: 'm1',
  conversationId: conversation.id,
  seq: 1,
  senderId: peer.id,
  text: 'hello',
  clientMessageId: 'client-1',
  createdAt: peer.createdAt,
};

/** Delivers a server event to the handler the app registered for it. */
function fire(event: string, payload: unknown) {
  const handler = socket.on.mock.calls.findLast(([name]) => name === event)![1];
  (handler as (payload: unknown) => void)(payload);
}

describe('realtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { visibilityState: 'visible' });
    socket.open.mockReturnValue(socket);
    socket.request.mockResolvedValue({ ok: true, data: { [peer.id]: false } });
  });

  afterEach(() => {
    stopRealtime();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    socket.request.mockReset();
  });

  it('re-checks online flags, so a peer lost with a crashed instance goes offline', async () => {
    startRealtime();
    conversations.upsert(conversation);
    // Online, and the "offline" that should follow never arrives.
    presence.set(peer.id, true);

    await vi.advanceTimersByTimeAsync(PRESENCE_RESYNC_MS);
    expect(socket.request).toHaveBeenCalledWith('presence:query', { userIds: [peer.id] });
    expect(get(presence)[peer.id]).toBe(false);
  });

  it('reads the story feed on connecting, when anything newer reaches the socket', () => {
    const load = vi.spyOn(stories, 'load').mockResolvedValue();
    startRealtime();
    expect(load).not.toHaveBeenCalled();

    socket.open.mock.lastCall![0].onConnect(false);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stops re-checking once signed out', async () => {
    startRealtime();
    stopRealtime();
    await vi.advanceTimersByTimeAsync(3 * PRESENCE_RESYNC_MS);
    expect(socket.request).not.toHaveBeenCalled();
  });

  it('forgets online flags with the connection: they would go stale unnoticed', () => {
    startRealtime();
    presence.set(peer.id, true);

    socket.open.mock.lastCall![0].onConnectionLost();

    expect(get(presence)).toEqual({});
  });

  it('does not queue typing events for after an outage', async () => {
    const { io } = await import('socket.io-client');
    const unconnected = io('http://localhost', { autoConnect: false });
    socket.current = unconnected;

    sendTyping(conversation.id, true);

    expect(unconnected.sendBuffer).toEqual([]);
    socket.current = null;
  });

  it('takes "typing…" down when the message it announced arrives', () => {
    startRealtime();
    fire('typing', { conversationId: conversation.id, userId: peer.id, isTyping: true });
    expect(get(typing)[conversation.id]).toBe(true);

    fire('message:new', { message, conversation });

    expect(get(typing)[conversation.id]).toBe(false);
  });
});
