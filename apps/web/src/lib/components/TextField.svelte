<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'value'> {
    label: string;
    name: string;
    value: string;
    error?: string;
    hint?: string;
  }

  let { label, name, value = $bindable(), error, hint, ...rest }: Props = $props();
  const id = $props.id();
</script>

<div class="flex flex-col gap-1.5">
  <label for={id} class="text-sm font-medium text-gray-700">{label}</label>
  <input
    {id}
    {name}
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error || hint ? `${id}-note` : undefined}
    class={[
      'rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 shadow-xs outline-none',
      'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20',
      error ? 'border-red-400' : 'border-gray-300',
    ]}
    {...rest}
  />
  {#if error}
    <p id="{id}-note" class="text-xs text-red-600">{error}</p>
  {:else if hint}
    <p id="{id}-note" class="text-xs text-gray-500">{hint}</p>
  {/if}
</div>
