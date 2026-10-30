import { writable } from 'svelte/store';
import type { ConnectionStatus } from '../socket/client.js';

/** Online flags by user id, for as long as we are connected; no flag means "we cannot tell". */
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

export type PeerStatus = 'connecting' | 'typing' | 'online' | 'offline' | null;

/** What can honestly be said about the peer; null while their flag has not arrived. */
export function peerStatus(
  connection: ConnectionStatus,
  online: boolean | undefined,
  typing: boolean,
): PeerStatus {
  if (connection !== 'online') return 'connecting';
  if (typing) return 'typing';
  if (online === undefined) return null;
  return online ? 'online' : 'offline';
}
