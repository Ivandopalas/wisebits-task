import { writable } from 'svelte/store';

/** A "typing" flag without a matching stop (tab closed, connection lost) expires on its own. */
export const TYPING_TTL_MS = 6000;
/** While the user keeps typing, the flag is sent again this often, well within the peer's TTL. */
export const TYPING_REFRESH_MS = 2500;
/** No keystroke for this long means the user has stopped typing. */
export const TYPING_IDLE_MS = 3000;

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

/** The sending side: turns keystrokes in the composer into typing events for the peer. */
export function createTypingNotifier(send: (conversationId: string, isTyping: boolean) => void) {
  let active: string | null = null;
  let sentAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function stop() {
    clearTimeout(idleTimer);
    if (active) {
      send(active, false);
      active = null;
    }
  }

  return {
    input(conversationId: string, hasText: boolean) {
      if (!hasText || active !== conversationId) {
        stop();
      }
      if (!hasText) {
        return;
      }
      if (active !== conversationId || Date.now() - sentAt >= TYPING_REFRESH_MS) {
        send(conversationId, true);
        active = conversationId;
        sentAt = Date.now();
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(stop, TYPING_IDLE_MS);
    },
    stop,
  };
}
