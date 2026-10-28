<script lang="ts">
  import { resolve } from '$app/paths';
  import type { StoryFeedItem } from '@chat/shared';
  import { currentUser } from '../stores/auth.js';
  import { stories } from '../stores/stories.js';
  import Avatar from './Avatar.svelte';
  import StoryViewer from './StoryViewer.svelte';

  // The viewer gets a snapshot: a live feed re-sorts as stories are seen or posted, and the
  // story being watched must not jump away.
  let viewing = $state<{ feed: StoryFeedItem[]; start: number } | null>(null);

  const feed = $derived($stories.feed);
  const mine = $derived(feed[0]?.author.id === $currentUser?.id ? feed[0] : undefined);
  const others = $derived(mine ? feed.slice(1) : feed);
  const offset = $derived(mine ? 1 : 0);
</script>

<div
  class="flex gap-3 overflow-x-auto border-b border-gray-200 px-4 py-3"
  data-testid="stories-bar"
>
  <div class="flex w-16 shrink-0 flex-col items-center gap-1">
    <div class="relative">
      {#if mine}
        <button
          type="button"
          onclick={() => (viewing = { feed, start: 0 })}
          aria-label="View your story"
        >
          <Avatar username={$currentUser?.username ?? '?'} size="lg" ring="seen" />
        </button>
      {:else}
        <a href={resolve('/(app)/stories/new')} aria-label="Record a story">
          <Avatar username={$currentUser?.username ?? '?'} size="lg" />
        </a>
      {/if}
      <a
        href={resolve('/(app)/stories/new')}
        class="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border-2 border-white bg-indigo-600 text-xs font-bold text-white"
        aria-label="Record a new story"
        data-testid="new-story"
      >
        +
      </a>
    </div>
    <span class="w-full truncate text-center text-xs text-gray-600">Your story</span>
  </div>

  {#each others as item, i (item.author.id)}
    <button
      type="button"
      class="flex w-16 shrink-0 flex-col items-center gap-1"
      onclick={() => (viewing = { feed, start: i + offset })}
      data-testid="story-author"
      data-unseen={item.hasUnseen}
    >
      <Avatar username={item.author.username} size="lg" ring={item.hasUnseen ? 'unseen' : 'seen'} />
      <span
        class={[
          'w-full truncate text-center text-xs',
          item.hasUnseen ? 'font-medium text-gray-900' : 'text-gray-500',
        ]}
      >
        {item.author.username}
      </span>
    </button>
  {/each}

  {#if $stories.status === 'ready' && others.length === 0}
    <p class="self-center text-xs text-gray-400">No stories from others yet</p>
  {/if}
</div>

{#if viewing}
  <StoryViewer feed={viewing.feed} startAuthor={viewing.start} onclose={() => (viewing = null)} />
{/if}
