<script lang="ts">
  import { avatarColor, initials } from '../utils/avatar.js';

  interface Props {
    username: string;
    size?: 'sm' | 'md' | 'lg';
    online?: boolean;
    /** Story ring: 'unseen' highlights, 'seen' is muted. */
    ring?: 'unseen' | 'seen' | null;
  }

  let { username, size = 'md', online = false, ring = null }: Props = $props();

  const sizes = { sm: 'size-8 text-xs', md: 'size-11 text-sm', lg: 'size-14 text-base' };
</script>

<span class="relative inline-flex shrink-0">
  <span
    class={[
      'inline-flex items-center justify-center rounded-full font-semibold text-white select-none',
      sizes[size],
      avatarColor(username),
      ring === 'unseen' && 'ring-2 ring-indigo-500 ring-offset-2',
      ring === 'seen' && 'ring-2 ring-gray-300 ring-offset-2',
    ]}
    aria-hidden="true"
  >
    {initials(username)}
  </span>
  {#if online}
    <span
      class="absolute right-0 bottom-0 size-3 rounded-full border-2 border-white bg-emerald-500"
      title="Online"
    ></span>
  {/if}
</span>
