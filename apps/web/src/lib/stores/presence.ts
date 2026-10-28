import { writable } from 'svelte/store';

/** Online flags by user id; unknown users are treated as offline. */
function createPresenceStore() {
  const state = writable<Record<string, boolean>>({});
  return {
    subscribe: state.subscribe,
    set: (userId: string, online: boolean) => state.update((s) => ({ ...s, [userId]: online })),
    merge: (flags: Record<string, boolean>) => state.update((s) => ({ ...s, ...flags })),
    reset: () => state.set({}),
  };
}

export const presence = createPresenceStore();
