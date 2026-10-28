<script lang="ts">
  import { connection } from '../socket/client.js';

  // A short blip on reconnect is normal; only a lasting outage deserves a banner.
  let visible = $state(false);

  $effect(() => {
    if ($connection === 'offline') {
      const timer = setTimeout(() => (visible = true), 1500);
      return () => clearTimeout(timer);
    }
    visible = false;
  });
</script>

{#if visible}
  <div
    class="flex items-center justify-center gap-2 bg-amber-100 px-3 py-1.5 text-sm text-amber-900"
    role="status"
    data-testid="connection-banner"
  >
    <span class="size-2 animate-pulse rounded-full bg-amber-500"></span>
    Connection lost. Reconnecting…
  </div>
{/if}
