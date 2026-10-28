<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { LIMITS, type ConversationDto } from '@chat/shared';
  import { tick, untrack } from 'svelte';
  import { errorMessage } from '#lib/api/http.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import MessageBubble from '#lib/components/MessageBubble.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import { markRead, sendTyping, syncPresence } from '#lib/realtime.js';
  import { currentUser } from '#lib/stores/auth.js';
  import { conversations } from '#lib/stores/conversations.js';
  import { messages } from '#lib/stores/messages.js';
  import { presence } from '#lib/stores/presence.js';
  import { typing } from '#lib/stores/typing.js';
  import { formatDayLabel, groupByDay } from '#lib/utils/format.js';

  const TYPING_IDLE_MS = 3000;
  const NEAR_BOTTOM_PX = 120;
  const NEAR_TOP_PX = 200;

  const id = $derived(page.params.id!);
  const conversation = $derived<ConversationDto | undefined>(
    $conversations.items.find((c) => c.id === id),
  );
  const thread = $derived($messages[id]);
  const items = $derived(thread?.items ?? []);
  const groups = $derived(groupByDay(items));
  const peerTyping = $derived(Boolean($typing[id]));

  let conversationError = $state<string | null>(null);
  let text = $state('');
  let scroller = $state<HTMLElement>();
  let composer = $state<HTMLTextAreaElement>();
  let stickToBottom = $state(true);
  /** Messages that arrived while the reader was scrolled up. */
  let newBelow = $state(0);
  let visible = $state(document.visibilityState === 'visible');
  let typingSent = false;
  let typingTimer: ReturnType<typeof setTimeout> | undefined;

  // Opening a conversation: make sure we know it, load its latest messages, focus the composer.
  $effect(() => {
    const conversationId = id;
    untrack(() => {
      conversationError = null;
      text = '';
      stickToBottom = true;
      conversations
        .ensure(conversationId)
        .then((c) => syncPresence([c.peer.id]))
        .catch((error: unknown) => (conversationError = errorMessage(error)));
      void messages.loadLatest(conversationId);
      composer?.focus();
    });
    return () => stopTyping(conversationId);
  });

  // New messages at the bottom: follow them if the user is already there or sent one,
  // otherwise count them on the "jump to latest" button.
  $effect(() => {
    const last = items.at(-1);
    if (!last) return;
    const mine = last.senderId === $currentUser?.id;
    untrack(() => {
      if (stickToBottom || mine) {
        void tick().then(scrollToBottom);
      } else {
        newBelow += 1;
      }
    });
  });

  function scrollToBottom() {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    stickToBottom = true;
    newBelow = 0;
  }

  // Seeing the conversation is reading it.
  $effect(() => {
    const seq = conversation?.lastMessage?.seq;
    if (
      visible &&
      thread?.status === 'ready' &&
      conversation &&
      conversation.unreadCount > 0 &&
      seq
    ) {
      markRead(conversation.id, seq);
    }
  });

  $effect(() => {
    const onVisibility = () => (visible = document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  async function onScroll() {
    if (!scroller) return;
    stickToBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX;
    if (stickToBottom) newBelow = 0;
    if (scroller.scrollTop < NEAR_TOP_PX && thread?.hasMore && !thread.loadingOlder) {
      // Keep the message under the reader's eyes in place while older ones are prepended.
      const fromBottom = scroller.scrollHeight - scroller.scrollTop;
      await messages.loadOlder(id);
      await tick();
      scroller.scrollTop = scroller.scrollHeight - fromBottom;
    }
  }

  function onInput() {
    if (!typingSent && text.trim()) {
      sendTyping(id, true);
      typingSent = true;
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => stopTyping(id), TYPING_IDLE_MS);
  }

  function stopTyping(conversationId: string) {
    clearTimeout(typingTimer);
    if (typingSent) {
      sendTyping(conversationId, false);
      typingSent = false;
    }
  }

  function submit(event?: SubmitEvent) {
    event?.preventDefault();
    const value = text.trim();
    if (!value || value.length > LIMITS.messageMaxLength) return;
    text = '';
    stopTyping(id);
    stickToBottom = true;
    void messages.send(id, value);
    composer?.focus();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  }
</script>

<svelte:head>
  <title>{conversation ? `${conversation.peer.username} · ` : ''}Realtime Chat</title>
</svelte:head>

{#if conversationError}
  <ErrorState message={conversationError} />
{:else}
  <header class="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
    <a
      href={resolve('/(app)/chats')}
      class="rounded-lg p-1 text-gray-600 hover:bg-gray-100 md:hidden"
      aria-label="Back to chats"
    >
      <svg class="size-5" viewBox="0 0 20 20" fill="currentColor"
        ><path
          d="M12.7 4.3a1 1 0 0 1 0 1.4L8.4 10l4.3 4.3a1 1 0 1 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0z"
        /></svg
      >
    </a>
    {#if conversation}
      <Avatar username={conversation.peer.username} online={$presence[conversation.peer.id]} />
      <div class="flex min-w-0 flex-col">
        <span class="truncate font-semibold text-gray-900" data-testid="chat-peer">
          {conversation.peer.username}
        </span>
        <span class="text-xs text-gray-500" data-testid="chat-status">
          {#if peerTyping}
            <span class="text-indigo-600">typing…</span>
          {:else if $presence[conversation.peer.id]}
            online
          {:else}
            offline
          {/if}
        </span>
      </div>
    {:else}
      <span class="h-4 w-32 animate-pulse rounded bg-gray-200"></span>
    {/if}
  </header>

  <div class="relative flex min-h-0 flex-1 flex-col">
    <div
      bind:this={scroller}
      onscroll={onScroll}
      class="min-h-0 flex-1 overflow-y-auto bg-gray-50 px-3 py-4 sm:px-6"
      data-testid="message-list"
    >
      {#if !thread || (thread.status === 'loading' && items.length === 0)}
        <div class="flex h-full items-center justify-center"><Spinner /></div>
      {:else if thread.status === 'error' && items.length === 0}
        <ErrorState
          message={thread.error ?? 'Could not load messages.'}
          onretry={() => messages.loadLatest(id)}
        />
      {:else if items.length === 0}
        <p class="flex h-full items-center justify-center text-sm text-gray-500">
          No messages yet. Say hello!
        </p>
      {:else}
        {#if thread.loadingOlder}
          <div class="flex justify-center pb-3"><Spinner /></div>
        {:else if !thread.hasMore}
          <p class="pb-3 text-center text-xs text-gray-400">
            This is the beginning of the conversation
          </p>
        {/if}
        {#each groups as group (group.day)}
          <section aria-label={formatDayLabel(group.day)}>
            <div class="sticky top-0 z-10 flex justify-center py-2">
              <span
                class="rounded-full bg-white/90 px-3 py-0.5 text-xs font-medium text-gray-500 shadow-xs"
              >
                {formatDayLabel(group.day)}
              </span>
            </div>
            <ul class="flex flex-col gap-1">
              {#each group.items as message (message.key)}
                <MessageBubble
                  {message}
                  mine={message.senderId === $currentUser?.id}
                  read={message.seq !== null && message.seq <= (conversation?.peerLastReadSeq ?? 0)}
                  onretry={() => messages.retry(id, message.clientMessageId)}
                />
              {/each}
            </ul>
          </section>
        {/each}
      {/if}
    </div>
    {#if !stickToBottom && items.length > 0}
      <button
        type="button"
        class="absolute right-4 bottom-4 flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-md ring-1 ring-gray-200 hover:bg-gray-50"
        onclick={scrollToBottom}
        data-testid="jump-to-latest"
      >
        {#if newBelow > 0}
          <span class="rounded-full bg-indigo-600 px-1.5 text-xs leading-5 text-white"
            >{newBelow}</span
          >
        {/if}
        Latest
        <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
          ><path d="M10 14.5 4.3 8.8a1 1 0 0 1 1.4-1.4L10 11.7l4.3-4.3a1 1 0 1 1 1.4 1.4z" /></svg
        >
      </button>
    {/if}
  </div>

  <form class="flex items-end gap-2 border-t border-gray-200 bg-white p-3" onsubmit={submit}>
    <div class="flex min-w-0 flex-1 flex-col">
      <textarea
        bind:this={composer}
        bind:value={text}
        oninput={onInput}
        onkeydown={onKeydown}
        rows="1"
        maxlength={LIMITS.messageMaxLength}
        placeholder="Write a message…"
        aria-label="Message"
        class="max-h-40 min-h-10 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none [field-sizing:content] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
      ></textarea>
      {#if text.length > LIMITS.messageMaxLength - 200}
        <span class="mt-1 self-end text-xs text-gray-500">
          {text.length}/{LIMITS.messageMaxLength}
        </span>
      {/if}
    </div>
    <button
      type="submit"
      class="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      disabled={!text.trim() || !thread || thread.status !== 'ready'}
    >
      Send
    </button>
  </form>
{/if}
