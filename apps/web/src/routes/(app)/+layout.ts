import { redirect } from '@sveltejs/kit';
import { auth } from '#lib/stores/auth.js';

// Everything here needs the in-memory access token, which only exists in the browser.
export const ssr = false;

export async function load({ url }) {
  if ((await auth.init()) === 'anonymous') {
    redirect(307, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
}
