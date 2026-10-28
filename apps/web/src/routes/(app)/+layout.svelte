<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Avatar from '#lib/components/Avatar.svelte';
  import ConnectionBanner from '#lib/components/ConnectionBanner.svelte';
  import ConversationList from '#lib/components/ConversationList.svelte';
  import StoriesBar from '#lib/components/StoriesBar.svelte';
  import { startRealtime, stopRealtime, syncPresence } from '#lib/realtime.js';
  import { auth } from '#lib/stores/auth.js';
  import { conversations, totalUnread } from '#lib/stores/conversations.js';
  import { stories } from '#lib/stores/stories.js';

  let { children } = $props();

  // On narrow screens the list and the open page take turns; on wide ones they sit side by side.
  const listOnly = $derived(page.route.id === '/(app)/chats');

  $effect(() => {
    startRealtime();
    void conversations.load().then(() => syncPresence());
    void stories.load();
    return stopRealtime;
  });

  $effect(() => {
    if ($auth.status === 'anonymous') {
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved path plus ?next=
      void goto(`${resolve('/(guest)/login')}?next=${encodeURIComponent(page.url.pathname)}`, {
        replace: true,
      });
    }
  });

  $effect(() => {
    document.title = $totalUnread > 0 ? `(${$totalUnread}) Realtime Chat` : 'Realtime Chat';
  });
</script>

<div class="flex h-dvh flex-col bg-white">
  <ConnectionBanner />
  <div class="flex min-h-0 flex-1">
    <aside
      class={[
        'min-h-0 w-full flex-col border-r border-gray-200 md:flex md:w-80 lg:w-96',
        listOnly ? 'flex' : 'hidden',
      ]}
    >
      <header class="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div class="flex min-w-0 items-center gap-2">
          <Avatar username={$auth.user?.username ?? '?'} size="sm" />
          <span class="truncate text-sm font-semibold text-gray-900" data-testid="current-user">
            {$auth.user?.username}
          </span>
        </div>
        <button
          type="button"
          class="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
          onclick={() => auth.logout()}
        >
          Sign out
        </button>
      </header>

      <StoriesBar />

      <nav class="flex gap-1 border-b border-gray-200 px-2 py-2 text-sm font-medium">
        <a
          href={resolve('/(app)/chats')}
          class={[
            'flex-1 rounded-lg px-3 py-1.5 text-center',
            page.route.id?.startsWith('/(app)/chats')
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-600 hover:bg-gray-50',
          ]}
        >
          Chats
        </a>
        <a
          href={resolve('/(app)/users')}
          class={[
            'flex-1 rounded-lg px-3 py-1.5 text-center',
            page.route.id === '/(app)/users'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-600 hover:bg-gray-50',
          ]}
        >
          People
        </a>
      </nav>

      <ConversationList />
    </aside>

    <main class={['min-h-0 min-w-0 flex-1 flex-col md:flex', listOnly ? 'hidden' : 'flex']}>
      {@render children()}
    </main>
  </div>
</div>
