<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';

  let { children } = $props();

  // The server's loading screen (see hooks.server.ts) has done its job once anything renders.
  onMount(() => document.getElementById('app-loading')?.remove());
</script>

{@render children()}
