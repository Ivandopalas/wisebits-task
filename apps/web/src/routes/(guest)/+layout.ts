import { browser } from '$app/env';
import { redirect } from '@sveltejs/kit';
import { auth } from '#lib/stores/auth.js';
import { safeNext } from '#lib/utils/redirect.js';

/** Signed-in users have no business on the sign-in pages. */
export async function load({ url }) {
  if (browser && (await auth.init().catch(() => 'anonymous')) === 'authenticated') {
    redirect(307, safeNext(url.searchParams.get('next')));
  }
}
