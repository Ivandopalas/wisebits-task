import { error, redirect } from '@sveltejs/kit';
import { errorMessage } from '#lib/api/http.js';
import { auth } from '#lib/stores/auth.js';

// Everything here needs the in-memory access token, which only exists in the browser.
export const ssr = false;

export async function load({ url }) {
  const status = await auth.init().catch((cause: unknown) => {
    // Without an explicit error SvelteKit would show its bare "Internal Error".
    error(503, errorMessage(cause));
  });
  if (status === 'anonymous') {
    redirect(307, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
}
