import type { Handle } from '@sveltejs/kit/hooks';

/**
 * Early redirect for visitors without a session hint cookie, so they never see an empty app
 * shell. The real check happens in the browser: only it holds the access token.
 */
export const handle: Handle = async ({ event, resolve }) => {
  if (event.route.id?.startsWith('/(app)') && !event.cookies.get('sid')) {
    const next = event.url.pathname + event.url.search;
    return new Response(null, {
      status: 303,
      headers: { location: `/login?next=${encodeURIComponent(next)}` },
    });
  }
  return resolve(event);
};
