import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTypingNotifier,
  createTypingStore,
  TYPING_IDLE_MS,
  TYPING_TTL_MS,
} from './typing.js';

describe('typing indicator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The sender on one side, the peer's store on the other, as the socket would connect them.
  function pair() {
    const peer = createTypingStore();
    const send = vi.fn((conversationId: string, isTyping: boolean) =>
      peer.set(conversationId, isTyping),
    );
    return { notifier: createTypingNotifier(send), peer, send };
  }

  it('stays on for the peer while the user keeps typing longer than its TTL', () => {
    const { notifier, peer } = pair();
    const seen: boolean[] = [];
    for (let elapsed = 0; elapsed <= 2 * TYPING_TTL_MS; elapsed += 700) {
      notifier.input('c1', true);
      seen.push(Boolean(get(peer).c1));
      vi.advanceTimersByTime(350);
      seen.push(Boolean(get(peer).c1));
      vi.advanceTimersByTime(350);
    }
    expect(seen.every(Boolean)).toBe(true);
  });

  it('goes off after a pause, and at once when the text is cleared', () => {
    const { notifier, peer, send } = pair();
    notifier.input('c1', true);
    vi.advanceTimersByTime(TYPING_IDLE_MS);
    expect(get(peer).c1).toBe(false);

    notifier.input('c1', true);
    notifier.input('c1', false);
    expect(get(peer).c1).toBe(false);
    expect(send).toHaveBeenLastCalledWith('c1', false);
  });

  it('sends one event per refresh period, not one per keystroke', () => {
    const { notifier, send } = pair();
    for (let i = 0; i < 20; i += 1) {
      notifier.input('c1', true);
      vi.advanceTimersByTime(100);
    }
    expect(send.mock.calls.filter(([, isTyping]) => isTyping)).toHaveLength(1);
  });

  it('stops in the previous conversation when the user switches', () => {
    const { notifier, peer } = pair();
    notifier.input('c1', true);
    notifier.input('c2', true);
    expect(get(peer)).toEqual({ c1: false, c2: true });
  });
});
