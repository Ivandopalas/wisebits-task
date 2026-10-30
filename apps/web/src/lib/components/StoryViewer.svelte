<script lang="ts">
  import type { StoryFeedItem } from '@chat/shared';
  import { untrack } from 'svelte';
  import { errorMessage } from '../api/http.js';
  import { currentUser } from '../stores/auth.js';
  import { stories } from '../stores/stories.js';
  import { formatRelative } from '../utils/format.js';
  import Avatar from './Avatar.svelte';

  interface Props {
    feed: StoryFeedItem[];
    startAuthor: number;
    onclose: () => void;
  }

  let { feed, startAuthor, onclose }: Props = $props();

  const firstUnseen = (item: StoryFeedItem | undefined) =>
    Math.max(item?.stories.findIndex((s) => !s.viewed) ?? 0, 0);

  // Where the viewer opens; from then on it navigates on its own.
  let authorIndex = $state(untrack(() => startAuthor));
  let storyIndex = $state(untrack(() => firstUnseen(feed[startAuthor])));
  let progress = $state(0);
  let paused = $state(false);
  let muted = $state(false);
  let error = $state<string | null>(null);
  let confirmingDelete = $state(false);
  let videoUrl = $state<string | null>(null);
  let dialog = $state<HTMLDialogElement>();
  let video = $state<HTMLVideoElement>();

  const item = $derived(feed[authorIndex]);
  const story = $derived(item?.stories[storyIndex]);
  const own = $derived(item?.author.id === $currentUser?.id);

  $effect(() => {
    if (!story) onclose();
  });

  // A modal dialog keeps Tab inside, closes on Escape and hands focus back to whatever opened it.
  $effect(() => {
    dialog?.showModal();
    // Rather than on its first button: Space has to pause, not go to the previous story.
    dialog?.focus();
  });

  $effect(() => {
    if (story && !story.viewed && !own) stories.markViewed(story.id);
  });

  $effect(() => {
    if (!story) return;
    let current = true;
    videoUrl = null;
    stories.videoUrl(story.id).then(
      (url) => {
        if (current) videoUrl = url;
      },
      (e) => {
        if (current) error = errorMessage(e);
      },
    );
    return () => {
      current = false;
    };
  });

  // Progress comes from the duration the recorder measured: some WebM files still report
  // Infinity as their duration, and the bar must not depend on that.
  $effect(() => {
    let frame = requestAnimationFrame(function loop() {
      if (video && story) progress = Math.min((video.currentTime * 1000) / story.durationMs, 1);
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  });

  function go(nextAuthor: number, nextStory: number) {
    progress = 0;
    paused = false;
    error = null;
    confirmingDelete = false;
    authorIndex = nextAuthor;
    storyIndex = nextStory;
  }

  function next() {
    if (!item) return;
    if (storyIndex < item.stories.length - 1) go(authorIndex, storyIndex + 1);
    else if (authorIndex < feed.length - 1) go(authorIndex + 1, firstUnseen(feed[authorIndex + 1]));
    else dialog?.close();
  }

  function previous() {
    if (storyIndex > 0) go(authorIndex, storyIndex - 1);
    else if (authorIndex > 0) go(authorIndex - 1, 0);
    else if (video) video.currentTime = 0;
  }

  async function play() {
    if (!video) return;
    try {
      await video.play();
    } catch {
      // Autoplay with sound can be refused; muted playback is always allowed.
      muted = true;
      video.muted = true;
      await video.play().catch(() => (paused = true));
    }
  }

  function togglePause() {
    if (!video) return;
    paused = !paused;
    if (paused) video.pause();
    else void play();
  }

  // Deleting cannot be undone, and the button sits next to the "next story" tap zone.
  function askToDelete() {
    confirmingDelete = true;
    paused = true;
    video?.pause();
  }

  function keepStory() {
    confirmingDelete = false;
    paused = false;
    void play();
  }

  async function remove() {
    if (!story) return;
    try {
      await stories.deleteOwn(story.id);
      dialog?.close();
    } catch (e) {
      error = errorMessage(e);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') next();
    else if (event.key === 'ArrowLeft') previous();
    // On a button Space is that button's own key.
    else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      togglePause();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if item && story}
  <dialog
    bind:this={dialog}
    {onclose}
    class="size-full max-h-none max-w-none items-center justify-center bg-black/90 outline-none open:flex sm:p-6"
    tabindex="-1"
    aria-label="Stories of {item.author.username}"
    data-testid="story-viewer"
  >
    <div
      class="relative aspect-[9/16] h-full max-h-dvh w-full max-w-md overflow-hidden bg-black sm:rounded-2xl"
    >
      {#if videoUrl}
        <video
          bind:this={video}
          src={videoUrl}
          class="h-full w-full object-cover"
          playsinline
          preload="auto"
          {muted}
          onloadeddata={play}
          onended={next}
          onerror={() => (error = 'This story could not be played.')}
          data-testid="story-video"
        ></video>
      {/if}

      <!-- Tap zones: left goes back, the rest goes forward. -->
      <button
        type="button"
        class="absolute inset-y-0 left-0 w-1/3"
        aria-label="Previous story"
        onclick={previous}
      ></button>
      <button
        type="button"
        class="absolute inset-y-0 right-0 w-2/3"
        aria-label="Next story"
        onclick={next}
      ></button>

      <div
        class="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-3 pb-10"
      >
        <div class="flex gap-1">
          {#each item.stories as s, i (s.id)}
            <div class="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                class="h-full bg-white"
                style:width="{i < storyIndex ? 100 : i === storyIndex ? progress * 100 : 0}%"
              ></div>
            </div>
          {/each}
        </div>
        <div class="mt-3 flex items-center gap-2">
          <Avatar username={item.author.username} size="sm" />
          <span class="text-sm font-semibold text-white"
            >{own ? 'Your story' : item.author.username}</span
          >
          <span class="text-xs text-white/70">{formatRelative(story.createdAt)}</span>
        </div>
      </div>

      <div class="absolute top-12 right-2 flex items-center gap-1">
        <button
          type="button"
          class="rounded-full p-2 text-white hover:bg-white/10"
          aria-label={paused ? 'Play' : 'Pause'}
          onclick={togglePause}
        >
          {#if paused}
            <svg class="size-5" viewBox="0 0 20 20" fill="currentColor"
              ><path d="M6 4l10 6-10 6z" /></svg
            >
          {:else}
            <svg class="size-5" viewBox="0 0 20 20" fill="currentColor"
              ><path d="M5 4h3v12H5zM12 4h3v12h-3z" /></svg
            >
          {/if}
        </button>
        {#if muted}
          <button
            type="button"
            class="rounded-full px-2 py-1 text-xs font-medium text-white hover:bg-white/10"
            onclick={() => {
              muted = false;
              if (video) video.muted = false;
            }}
          >
            Unmute
          </button>
        {/if}
        <button
          type="button"
          class="rounded-full p-2 text-white hover:bg-white/10"
          aria-label="Close"
          onclick={() => dialog?.close()}
        >
          <svg class="size-5" viewBox="0 0 20 20" fill="currentColor"
            ><path
              d="M4.3 4.3a1 1 0 0 1 1.4 0L10 8.6l4.3-4.3a1 1 0 1 1 1.4 1.4L11.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 0 1-1.4-1.4L8.6 10 4.3 5.7a1 1 0 0 1 0-1.4z"
            /></svg
          >
        </button>
      </div>

      {#if own && confirmingDelete}
        <div
          class="absolute inset-x-3 bottom-4 flex items-center justify-between gap-3 rounded-xl bg-black/80 px-3 py-2 text-sm text-white"
          role="alertdialog"
          aria-label="Delete this story?"
        >
          <span>Delete this story?</span>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-xs font-medium hover:bg-white/10"
              onclick={keepStory}
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold hover:bg-red-500"
              onclick={remove}
            >
              Delete
            </button>
          </div>
        </div>
      {:else if own}
        <button
          type="button"
          class="absolute right-3 bottom-4 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white hover:bg-black/70"
          onclick={askToDelete}
        >
          Delete
        </button>
      {/if}

      {#if error}
        <p
          class="absolute inset-x-4 bottom-16 rounded-lg bg-black/70 px-3 py-2 text-center text-sm text-white"
          role="alert"
        >
          {error}
        </p>
      {/if}
    </div>
  </dialog>
{/if}
