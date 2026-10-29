<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>{page.status} · Realtime Chat</title>
</svelte:head>

<main class="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
  <p class="text-5xl font-bold text-gray-300">{page.status}</p>
  <h1 class="text-lg font-semibold text-gray-900">
    {page.status === 404
      ? 'Page not found'
      : page.status === 503
        ? 'The server is not reachable'
        : 'Something went wrong'}
  </h1>
  <p class="max-w-sm text-sm text-gray-600">{page.error?.message}</p>
  <div class="flex gap-3">
    <button
      type="button"
      class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
      onclick={() => location.reload()}
    >
      Reload
    </button>
    <a
      href={resolve('/(app)/chats')}
      class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
    >
      Go to chats
    </a>
  </div>
</main>
