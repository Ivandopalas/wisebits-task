import type { AuthResponse } from '@chat/shared';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app.js';
import { connect, connectError, disconnectAll, nextDisconnect } from './helpers/sockets.js';
import { registerUser } from './helpers/users.js';

const TTL_SECONDS = 3;

describe('socket lifetime', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ ACCESS_TOKEN_TTL_SECONDS: String(TTL_SECONDS) });
  });

  afterEach(() => disconnectAll());

  afterAll(async () => {
    await t.close();
  });

  it('closes the socket when its access token expires, a refreshed token gets back in', async () => {
    const user = await registerUser(t.url);
    const { exp } = t.app.get(JwtService).decode<{ exp: number }>(user.accessToken);
    const socket = await connect(t.url, user.accessToken);

    expect(await nextDisconnect(socket, (TTL_SECONDS + 2) * 1000)).toBe('io server disconnect');
    expect(Date.now()).toBeGreaterThanOrEqual(exp * 1000 - 50);
    expect(await connectError(t.url, user.accessToken)).toMatchObject({ code: 'TOKEN_EXPIRED' });

    const refreshed = await request(t.url)
      .post('/api/auth/refresh')
      .set('Cookie', user.cookies)
      .expect(200);
    const back = await connect(t.url, (refreshed.body as AuthResponse).accessToken);
    expect(back.connected).toBe(true);
  });
});
