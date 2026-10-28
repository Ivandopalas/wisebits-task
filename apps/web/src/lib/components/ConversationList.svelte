<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { conversations } from '../stores/conversations.js';
  import { presence } from '../stores/presence.js';
  import { typing } from '../stores/typing.js';
  import { currentUser } from '../stores/auth.js';
  import { formatListTime } from '../utils/format.js';
  import Avatar from './Avatar.svelte';
  import ErrorState from './ErrorState.svelte';
  import Spinner from './Spinner.svelte';

  const activeId = $derived(page.params.id);

  function onScroll(event: Event) {
    const el = event.currentTarget as HTMLElement;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      void conversations.loadMore();
    }
  }
</script>

<div class="min-h-0 flex-1 overflow-y-auto" onscroll={onScroll}>
  {#if $conversations.status === 'loading' || $conversations.status === 'idle'}
    <ul class="flex flex-col" aria-busy="true" aria-label="Loading conversations">
      {#each { length: 6 } as _, i (i)}
        <li class="flex items-center gap-3 px-4 py-3">
          <span class="size-11 animate-pulse rounded-full bg-gray-200"></span>
          <span class="flex flex-1 flex-col gap-2">
            <span class="h-3 w-1/3 animate-pulse rounded bg-gray-200"></span>
            <span class="h-3 w-2/3 animate-pulse rounded bg-gray-100"></span>
          </span>
        </li>
      {/each}
    </ul>
  {:else if $conversations.status === 'error'}
    <ErrorState
      message={$conversations.error ?? 'Could not load conversations.'}
      onretry={() => conversations.load()}
    />
  {:else if $conversations.items.length === 0}
    <div class="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p class="text-sm font-medium text-gray-900">No conversations yet</p>
      <p class="text-sm text-gray-500">Find someone in People and say hi.</p>
      <a
        href={resolve('/(app)/users')}
        class="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Find people
      </a>
    </div>
  {:else}
    <ul data-testid="conversation-list">
      {#each $conversations.items as conversation (conversation.id)}
        {@const last = conversation.lastMessage}
        {@const isTyping = $typing[conversation.id]}
        <li>
          <a
            href={resolve('/(app)/chats/[id]', { id: conversation.id })}
            class={[
              'flex items-center gap-3 px-4 py-3 hover:bg-gray-50',
              activeId === conversation.id && 'bg-indigo-50 hover:bg-indigo-50',
            ]}
            aria-current={activeId === conversation.id ? 'page' : undefined}
            data-testid="conversation-item"
          >
            <Avatar
              username={conversation.peer.username}
              online={$presence[conversation.peer.id]}
            />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="flex items-baseline justify-between gap-2">
                <span class="truncate font-medium text-gray-900">{conversation.peer.username}</span>
                <span class="shrink-0 text-xs text-gray-500">
                  {formatListTime(conversation.lastActivityAt)}
                </span>
              </span>
              <span class="flex items-center justify-between gap-2">
                <span class="truncate text-sm text-gray-500">
                  {#if isTyping}
                    <span class="text-indigo-600">typing…</span>
                  {:else if last}
                    {last.senderId === $currentUser?.id ? 'You: ' : ''}{last.text}
                  {:else}
                    <span class="italic">No messages yet</span>
                  {/if}
                </span>
                {#if conversation.unreadCount > 0}
                  <span
                    class="min-w-5 shrink-0 rounded-full bg-indigo-600 px-1.5 text-center text-xs leading-5 font-semibold text-white"
                    data-testid="unread-badge"
                  >
                    {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                  </span>
                {/if}
              </span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
    {#if $conversations.loadingMore}
      <div class="flex justify-center py-3"><Spinner /></div>
    {/if}
  {/if}
</div>
