import { get } from 'svelte/store';
import { closeSocket, currentSocket, openSocket, request } from './socket/client.js';
import { auth } from './stores/auth.js';
import { conversations } from './stores/conversations.js';
import { messages } from './stores/messages.js';
import { presence } from './stores/presence.js';
import { stories } from './stores/stories.js';
import { typing } from './stores/typing.js';

const myId = () => get(auth).user?.id ?? '';

// "Offline" is announced by the instance a user disconnects from. When that instance crashes,
// nobody is left to announce it, so the online flags are re-checked now and then.
export const PRESENCE_RESYNC_MS = 30_000;
let presenceTimer: ReturnType<typeof setInterval> | undefined;

export function startRealtime(): void {
  const socket = openSocket({
    token: auth.freshToken,
    refresh: auth.refresh,
    onUnauthorized: () => void auth.logout(),
    // Nobody tells us who came and went while we are away.
    onConnectionLost: () => presence.reset(),
    onConnect: (resumed) => {
      void syncPresence();
      if (resumed) {
        // Whatever happened while we were away: new conversations, missed messages.
        void conversations.load();
        for (const id of messages.loadedConversationIds()) {
          void messages.catchUp(id).catch(() => undefined);
        }
        void stories.load();
      }
      void messages.retryFailed();
    },
  });

  socket.on('message:new', ({ message, conversation }) => {
    // A conversation we have not seen before: nobody has told us yet whether this peer is online.
    if (!(conversation.peer.id in get(presence))) {
      void syncPresence([conversation.peer.id]);
    }
    conversations.upsert(conversation);
    messages.receive(message);
    if (message.senderId !== myId()) {
      typing.set(conversation.id, false);
    }
  });
  socket.on('conversation:read', (event) => conversations.applyRead(event, myId()));
  socket.on('typing', (event) => typing.set(event.conversationId, event.isTyping));
  socket.on('presence', (event) => presence.set(event.userId, event.online));
  socket.on('story:created', () => stories.reloadSoon());
  socket.on('story:deleted', (event) => stories.remove(event.storyId));

  clearInterval(presenceTimer);
  presenceTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void syncPresence();
    }
  }, PRESENCE_RESYNC_MS);
}

export function stopRealtime(): void {
  clearInterval(presenceTimer);
  closeSocket();
  conversations.reset();
  messages.reset();
  presence.reset();
  typing.reset();
  stories.reset();
}

/** Online flags for everyone in the conversation list. */
export async function syncPresence(userIds = get(conversations).items.map((c) => c.peer.id)) {
  if (userIds.length === 0 || !currentSocket()?.connected) {
    return;
  }
  const result = await request('presence:query', { userIds: userIds.slice(0, 200) }).catch(
    () => null,
  );
  if (result?.ok) {
    presence.merge(result.data);
  }
}

export function sendTyping(conversationId: string, isTyping: boolean): void {
  // Volatile: useless once late, so it is dropped rather than queued while disconnected.
  currentSocket()?.volatile.emit('typing', { conversationId, isTyping });
}

export function markRead(conversationId: string, seq: number): void {
  conversations.clearUnread(conversationId);
  void request('conversation:read', { conversationId, seq }).catch(() => undefined);
}
