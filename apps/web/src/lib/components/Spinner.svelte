<script lang="ts">
  let { label = 'Loading', class: className = 'size-5' }: { label?: string; class?: string } =
    $props();
</script>

<svg
  class={['animate-spin text-indigo-500', className]}
  viewBox="0 0 24 24"
  fill="none"
  role="status"
>
  <title>{label}</title>
  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-20" />
  <path
    d="M22 12a10 10 0 0 0-10-10"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
  />
</svg>
