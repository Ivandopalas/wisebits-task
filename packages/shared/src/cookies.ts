/**
 * Non-secret hint that a session probably exists. The SvelteKit server cannot see the refresh
 * token (scoped to /api/auth) and uses this to redirect guests before rendering; the browser
 * reads it to skip a pointless refresh call when there is no session at all.
 */
export const SESSION_HINT_COOKIE = 'sid';
