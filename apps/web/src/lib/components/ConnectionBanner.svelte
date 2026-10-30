<script lang="ts">
  import { connection } from '../socket/client.js';
</script>

{#if $connection === 'offline'}
  <div
    class="flex items-center justify-center gap-2 bg-amber-100 px-3 py-1.5 text-sm text-amber-900"
    role="status"
    data-testid="connection-banner"
  >
    <span class="size-2 animate-pulse rounded-full bg-amber-500"></span>
    Connection lost. Reconnecting…
  </div>
{/if}
