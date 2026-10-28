<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import type { Page, UserDto } from '@chat/shared';
  import { api, errorMessage } from '#lib/api/http.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import { syncPresence } from '#lib/realtime.js';
  import { conversations } from '#lib/stores/conversations.js';
  import { presence } from '#lib/stores/presence.js';

  const SEARCH_DEBOUNCE_MS = 300;

  let query = $state('');
  let users = $state<UserDto[]>([]);
  let nextCursor = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let error = $state<string | null>(null);
  let loadingMore = $state(false);
  let openingId = $state<string | null>(null);
  let openError = $state<string | null>(null);
  let controller: AbortController | null = null;

  async function search(q: string) {
    controller?.abort();
    controller = new AbortController();
    status = 'loading';
    error = null;
    try {
      const page = await api<Page<UserDto>>('/users', {
        query: { q: q.trim() || undefined },
        signal: controller.signal,
      });
      users = page.items;
      nextCursor = page.nextCursor;
      status = 'ready';
      void syncPresence(page.items.map((u) => u.id));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      error = errorMessage(e);
      status = 'error';
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await api<Page<UserDto>>('/users', {
        query: { q: query.trim() || undefined, cursor: nextCursor },
      });
      users = [...users, ...page.items];
      nextCursor = page.nextCursor;
      void syncPresence(page.items.map((u) => u.id));
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loadingMore = false;
    }
  }

  async function message(user: UserDto) {
    openingId = user.id;
    openError = null;
    try {
      const conversation = await conversations.open(user.id);
      await goto(resolve('/(app)/chats/[id]', { id: conversation.id }));
    } catch (e) {
      openError = errorMessage(e);
    } finally {
      openingId = null;
    }
  }

  $effect(() => {
    const q = query;
    const timer = setTimeout(() => search(q), q ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  });

  $effect(() => () => controller?.abort());
</script>

<svelte:head>
  <title>People · Realtime Chat</title>
</svelte:head>

<header class="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
  <a
    href={resolve('/(app)/chats')}
    class="rounded-lg p-1 text-gray-600 hover:bg-gray-100 md:hidden"
    aria-label="Back"
  >
    <svg class="size-5" viewBox="0 0 20 20" fill="currentColor"
      ><path
        d="M12.7 4.3a1 1 0 0 1 0 1.4L8.4 10l4.3 4.3a1 1 0 1 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0z"
      /></svg
    >
  </a>
  <h1 class="font-semibold text-gray-900">People</h1>
</header>

<div class="border-b border-gray-200 p-3">
  <input
    type="search"
    placeholder="Search by username"
    aria-label="Search by username"
    bind:value={query}
    class="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
  />
</div>

{#if openError}
  <p class="bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">{openError}</p>
{/if}

<div class="min-h-0 flex-1 overflow-y-auto">
  {#if status === 'loading'}
    <div class="flex justify-center py-10"><Spinner /></div>
  {:else if status === 'error'}
    <ErrorState message={error ?? 'Could not load people.'} onretry={() => search(query)} />
  {:else if users.length === 0}
    <p class="px-6 py-12 text-center text-sm text-gray-500">
      {query.trim() ? `Nobody found for “${query.trim()}”.` : 'No other users yet.'}
    </p>
  {:else}
    <ul class="divide-y divide-gray-100" data-testid="user-list">
      {#each users as user (user.id)}
        <li class="flex items-center gap-3 px-4 py-3">
          <Avatar username={user.username} online={$presence[user.id]} />
          <span class="min-w-0 flex-1 truncate font-medium text-gray-900">{user.username}</span>
          <button
            type="button"
            class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            disabled={openingId !== null}
            onclick={() => message(user)}
          >
            {openingId === user.id ? 'Opening…' : 'Message'}
          </button>
        </li>
      {/each}
    </ul>
    {#if nextCursor}
      <div class="flex justify-center p-4">
        <button
          type="button"
          class="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          disabled={loadingMore}
          onclick={loadMore}
        >
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      </div>
    {/if}
  {/if}
</div>
