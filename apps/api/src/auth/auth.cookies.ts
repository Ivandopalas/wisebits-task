import type { Response } from 'express';
import type { IssuedRefreshToken } from './sessions.service.js';

export const REFRESH_COOKIE = 'rt';
/**
 * Non-secret hint that a session probably exists. The SvelteKit server cannot see the refresh
 * token (scoped to /api/auth) and uses this to redirect guests before rendering; the browser
 * reads it to skip a pointless refresh call when there is no session at all.
 */
export const SESSION_HINT_COOKIE = 'sid';

const REFRESH_PATH = '/api/auth';

export function setAuthCookies(res: Response, refresh: IssuedRefreshToken, secure: boolean) {
  const expires = refresh.expiresAt;
  res.cookie(REFRESH_COOKIE, refresh.token, {
    httpOnly: true,
    secure,
    expires,
    sameSite: 'strict',
    path: REFRESH_PATH,
  });
  res.cookie(SESSION_HINT_COOKIE, '1', {
    httpOnly: false,
    secure,
    expires,
    sameSite: 'lax',
    path: '/',
  });
}

export function clearAuthCookies(res: Response, secure: boolean) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_PATH,
  });
  res.clearCookie(SESSION_HINT_COOKIE, { secure, sameSite: 'lax', path: '/' });
}
