import { get } from 'svelte/store';
import { closeSocket, currentSocket, openSocket, request } from './socket/client.js';
import { auth } from './stores/auth.js';
import { conversations } from './stores/conversations.js';
import { messages } from './stores/messages.js';
import { presence } from './stores/presence.js';
import { stories } from './stores/stories.js';
import { typing } from './stores/typing.js';

const myId = () => get(auth).user?.id ?? '';

/** Connects the socket and routes its events into the stores. */
export function startRealtime(): void {
  const socket = openSocket({
    token: auth.freshToken,
    refresh: auth.refresh,
    onUnauthorized: () => void auth.logout(),
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
    conversations.upsert(conversation);
    messages.receive(message);
    if (message.senderId !== myId()) {
      typing.set(conversation.id, false);
    }
  });
  socket.on('conversation:read', (event) => conversations.applyRead(event, myId()));
  socket.on('typing', (event) => typing.set(event.conversationId, event.isTyping));
  socket.on('presence', (event) => presence.set(event.userId, event.online));
  socket.on('story:created', () => void stories.load());
  socket.on('story:deleted', (event) => stories.remove(event.storyId));
}

export function stopRealtime(): void {
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
  currentSocket()?.emit('typing', { conversationId, isTyping });
}

export function markRead(conversationId: string, seq: number): void {
  conversations.clearUnread(conversationId);
  void request('conversation:read', { conversationId, seq }).catch(() => undefined);
}
