import { SESSION_HINT_COOKIE } from '@chat/shared';
import type { Handle } from '@sveltejs/kit/hooks';

// Signed-in pages render in the browser, after the session is restored; until then the page
// would be blank. Plain markup with inline styles: no stylesheet or script has loaded yet.
const LOADING_SCREEN = `<div id="app-loading" role="status" aria-label="Loading" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#fff"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg></div>`;

/**
 * Early redirect for visitors without a session hint cookie, so they never see an empty app
 * shell. The real check happens in the browser: only it holds the access token.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const signedInArea = event.route.id?.startsWith('/(app)') ?? false;
  if (signedInArea && !event.cookies.get(SESSION_HINT_COOKIE)) {
    const next = event.url.pathname + event.url.search;
    return new Response(null, {
      status: 303,
      headers: { location: `/login?next=${encodeURIComponent(next)}` },
    });
  }
  return resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace('%app.loading%', signedInArea ? LOADING_SCREEN : ''),
  });
};
