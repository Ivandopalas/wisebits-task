import type { AuthResponse } from '@chat/shared';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

export interface TestUser extends AuthResponse {
  password: string;
  /** Raw `name=value` pairs from Set-Cookie, ready for a Cookie header. */
  cookies: string[];
  auth: { Authorization: string };
}

let counter = 0;

export function uniqueName(prefix = 'user'): string {
  counter += 1;
  return `${prefix}_${counter}_${randomBytes(3).toString('hex')}`;
}

export async function registerUser(baseUrl: string, username = uniqueName()): Promise<TestUser> {
  const password = 'Password123!';
  const res = await request(baseUrl)
    .post('/api/auth/register')
    .send({ email: `${username}@example.com`, username, password })
    .expect(201);
  const body = res.body as AuthResponse;
  return {
    ...body,
    password,
    cookies: readCookies(res.headers['set-cookie']),
    auth: { Authorization: `Bearer ${body.accessToken}` },
  };
}

export function readCookies(header: string | string[] | undefined): string[] {
  const list = Array.isArray(header) ? header : header ? [header] : [];
  return list.map((cookie) => cookie.split(';')[0]!);
}

export function cookieValue(cookies: string[], name: string): string | undefined {
  return cookies.find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}
