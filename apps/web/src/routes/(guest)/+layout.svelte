<script lang="ts">
  let { children } = $props();
</script>

<main class="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-10">
  <div class="w-full max-w-sm">
    <div class="mb-8 flex flex-col items-center gap-3 text-center">
      <img src="/favicon.svg" alt="" class="size-12" />
      <h1 class="text-xl font-semibold text-gray-900">Realtime Chat</h1>
    </div>
    <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      {@render children()}
    </div>
  </div>
</main>
