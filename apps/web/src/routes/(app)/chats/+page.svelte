<script lang="ts">
  import { resolve } from '$app/paths';
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
  <p class="text-sm font-medium text-gray-900">Select a conversation</p>
  <p class="text-sm text-gray-500">
    Or <a href={resolve('/(app)/users')} class="font-medium text-indigo-600 hover:text-indigo-500"
      >find someone</a
    > to start a new one.
  </p>
</div>
