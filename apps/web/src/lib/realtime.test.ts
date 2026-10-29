import type { ConversationDto } from '@chat/shared';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const socket = vi.hoisted(() => ({
  connected: true,
  on: vi.fn(),
  request: vi.fn(),
}));

vi.mock('./socket/client.js', async () => {
  const { writable } = await import('svelte/store');
  return {
    connection: writable('idle'),
    openSocket: () => socket,
    closeSocket: vi.fn(),
    currentSocket: () => socket,
    request: socket.request,
  };
});

const { PRESENCE_RESYNC_MS, startRealtime, stopRealtime } = await import('./realtime.js');
const { conversations } = await import('./stores/conversations.js');
const { presence } = await import('./stores/presence.js');

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

describe('realtime presence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { visibilityState: 'visible' });
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

  it('stops re-checking once signed out', async () => {
    startRealtime();
    stopRealtime();
    await vi.advanceTimersByTimeAsync(3 * PRESENCE_RESYNC_MS);
    expect(socket.request).not.toHaveBeenCalled();
  });
});
