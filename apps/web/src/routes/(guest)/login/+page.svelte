<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { loginSchema } from '@chat/shared';
  import { ApiRequestError, errorMessage } from '#lib/api/http.js';
  import TextField from '#lib/components/TextField.svelte';
  import { auth } from '#lib/stores/auth.js';
  import { fieldErrors } from '#lib/utils/form.js';
  import { safeNext } from '#lib/utils/redirect.js';

  let email = $state('');
  let password = $state('');
  let errors = $state<Record<string, string>>({});
  let formError = $state<string | null>(null);
  let submitting = $state(false);
  // Until the scripts have loaded, a submit is the browser's own: a full page request carrying
  // the form fields. The button waits for the app instead.
  let hydrated = $state(false);
  onMount(() => (hydrated = true));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      errors = fieldErrors(parsed.error.issues);
      return;
    }
    errors = {};
    formError = null;
    submitting = true;
    try {
      await auth.login(parsed.data);
      // `next` is an arbitrary path, already checked to stay on this site by safeNext().
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      await goto(safeNext(page.url.searchParams.get('next')), { replace: true });
    } catch (error) {
      const fields = error instanceof ApiRequestError ? error.fieldErrors : {};
      if (Object.keys(fields).length > 0) {
        errors = fields;
      } else {
        formError = errorMessage(error);
      }
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Sign in · Realtime Chat</title>
</svelte:head>

<h2 class="mb-6 text-lg font-semibold text-gray-900">Sign in</h2>

<form class="flex flex-col gap-4" method="post" novalidate onsubmit={submit}>
  <TextField
    label="Email"
    name="email"
    type="email"
    autocomplete="email"
    bind:value={email}
    error={errors.email}
  />
  <TextField
    label="Password"
    name="password"
    type="password"
    autocomplete="current-password"
    bind:value={password}
    error={errors.password}
  />

  {#if formError}
    <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{formError}</p>
  {/if}

  <button
    type="submit"
    class="mt-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
    disabled={!hydrated || submitting}
  >
    {submitting ? 'Signing in…' : 'Sign in'}
  </button>
</form>

<p class="mt-6 text-center text-sm text-gray-600">
  No account yet?
  <!-- Keeps ?next= so the user still lands where they were headed. -->
  <!-- eslint-disable svelte/no-navigation-without-resolve -->
  <a
    href={`${resolve('/(guest)/register')}${page.url.search}`}
    class="font-medium text-indigo-600 hover:text-indigo-500">Create one</a
  >
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
</p>
