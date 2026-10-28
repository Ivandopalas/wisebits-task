<script lang="ts">
  interface Props {
    message: string;
    onretry?: () => void;
  }

  let { message, onretry }: Props = $props();
</script>

<div class="flex flex-col items-center gap-3 p-6 text-center" role="alert">
  <p class="text-sm text-gray-600">{message}</p>
  {#if onretry}
    <button
      type="button"
      class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      onclick={onretry}
    >
      Try again
    </button>
  {/if}
</div>
