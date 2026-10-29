<script lang="ts">
  import type { ChatMessage } from '../stores/messages.js';
  import { formatTime } from '../utils/format.js';

  interface Props {
    message: ChatMessage;
    mine: boolean;
    /** The peer has read it (only meaningful for my messages). */
    read: boolean;
    onretry: () => void;
  }

  let { message, mine, read, onretry }: Props = $props();

  const failed = $derived(message.status === 'failed');
</script>

<li
  class={['flex', mine ? 'justify-end' : 'justify-start']}
  data-testid="message"
  data-status={message.status}
>
  <div
    class={[
      'max-w-[85%] rounded-2xl px-3 py-1.5 text-sm shadow-xs sm:max-w-[min(70%,40rem)]',
      mine ? 'rounded-br-md' : 'rounded-bl-md',
      failed
        ? 'bg-red-50 text-red-900 ring-1 ring-red-200'
        : mine
          ? 'bg-indigo-600 text-white'
          : 'bg-white text-gray-900',
    ]}
  >
    <p class="break-words whitespace-pre-wrap">{message.text}</p>
    <p
      class={[
        'mt-0.5 flex items-center justify-end gap-1 text-[11px]',
        failed ? 'text-red-700' : mine ? 'text-indigo-100' : 'text-gray-500',
      ]}
    >
      <time datetime={message.createdAt}>{formatTime(message.createdAt)}</time>
      {#if mine}
        {#if message.status === 'sending'}
          <span title="Sending" data-testid="message-sending">
            <svg
              class="size-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              ><circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 1.5" stroke-linecap="round" /></svg
            >
          </span>
        {:else if message.status === 'sent'}
          <span title={read ? 'Read' : 'Sent'} data-testid={read ? 'message-read' : 'message-sent'}>
            <svg
              class="h-4 w-5"
              viewBox="0 0 17 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M1.5 8.5 5 12l6.5-7.5" />
              {#if read}<path d="m7 10.5 1.5 1.5 6.5-7.5" />{/if}
            </svg>
          </span>
        {/if}
      {/if}
    </p>
    {#if failed}
      <p class="mt-1 flex items-center justify-end gap-2 text-xs" data-testid="message-failed">
        <span>{message.error ?? 'Not delivered'}</span>
        <button type="button" class="font-semibold underline" onclick={onretry}>Retry</button>
      </p>
    {/if}
  </div>
</li>
