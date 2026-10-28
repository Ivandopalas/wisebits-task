import { writable } from 'svelte/store';

/** A "typing" flag without a matching stop (tab closed, connection lost) expires on its own. */
export const TYPING_TTL_MS = 6000;

export function createTypingStore(ttlMs = TYPING_TTL_MS) {
  const state = writable<Record<string, boolean>>({});
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function set(conversationId: string, isTyping: boolean) {
    clearTimeout(timers.get(conversationId));
    timers.delete(conversationId);
    state.update((s) => ({ ...s, [conversationId]: isTyping }));
    if (isTyping) {
      timers.set(
        conversationId,
        setTimeout(() => set(conversationId, false), ttlMs),
      );
    }
  }

  return {
    subscribe: state.subscribe,
    set,
    reset() {
      timers.forEach(clearTimeout);
      timers.clear();
      state.set({});
    },
  };
}

/** Conversation id → whether the peer is typing there right now. */
export const typing = createTypingStore();
