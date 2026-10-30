import { SESSION_HINT_COOKIE } from '@chat/shared';
import type { Response } from 'express';
import type { IssuedRefreshToken } from './sessions.service.js';

export const REFRESH_COOKIE = 'rt';

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
