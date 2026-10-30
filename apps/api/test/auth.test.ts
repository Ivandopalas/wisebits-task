import type { StoryDto, StoryPlaybackDto } from '@chat/shared';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { cookieValue, readCookies, registerUser, uniqueName } from './helpers/users.js';
import { fakeWebm } from './helpers/videos.js';

describe('auth', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  const refresh = (cookies: string[]) =>
    request(t.url).post('/api/auth/refresh').set('Cookie', cookies);

  describe('register', () => {
    it('creates the user, signs them in and sets the session cookies', async () => {
      const username = uniqueName('Reg');
      const res = await request(t.url)
        .post('/api/auth/register')
        .send({
          email: `  ${username.toUpperCase()}@Example.com `,
          username,
          password: 'Password123!',
        })
        .expect(201);

      expect(res.body.user).toMatchObject({
        username,
        email: `${username.toLowerCase()}@example.com`,
      });
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.expiresIn).toBe(900);

      const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      const rt = setCookie.find((c) => c.startsWith('rt='));
      expect(rt).toMatch(/HttpOnly/i);
      expect(rt).toMatch(/SameSite=Strict/i);
      expect(rt).toMatch(/Path=\/api\/auth/);
      expect(setCookie.find((c) => c.startsWith('sid='))).toMatch(/Path=\//);
    });

    it('rejects a taken email or username regardless of case with 409 and the field', async () => {
      const existing = await registerUser(t.url);

      const sameEmail = await request(t.url)
        .post('/api/auth/register')
        .send({
          email: existing.user.email.toUpperCase(),
          username: uniqueName(),
          password: 'Password123!',
        })
        .expect(409);
      expect(sameEmail.body.details).toEqual([{ path: 'email', message: 'Already registered' }]);

      const sameUsername = await request(t.url)
        .post('/api/auth/register')
        .send({
          email: `${uniqueName()}@example.com`,
          username: existing.user.username.toUpperCase(),
          password: 'Password123!',
        })
        .expect(409);
      expect(sameUsername.body.details).toEqual([{ path: 'username', message: 'Already taken' }]);
    });

    it('validates the payload and lists every problem', async () => {
      const res = await request(t.url)
        .post('/api/auth/register')
        .send({ email: 'not-an-email', username: 'a b', password: 'short' })
        .expect(400);
      expect(res.body.message).toBe('Validation failed');
      const paths = (res.body.details as Array<{ path: string }>).map((d) => d.path).sort();
      expect(paths).toEqual(['email', 'password', 'username']);
    });

    it('rejects unknown fields', async () => {
      await request(t.url)
        .post('/api/auth/register')
        .send({
          email: 'x@example.com',
          username: uniqueName(),
          password: 'Password123!',
          role: 'admin',
        })
        .expect(400);
    });
  });

  describe('login', () => {
    it('signs in with the email in any case', async () => {
      const user = await registerUser(t.url);
      const res = await request(t.url)
        .post('/api/auth/login')
        .send({ email: user.user.email.toUpperCase(), password: user.password })
        .expect(200);
      expect(res.body.user.id).toBe(user.user.id);
      expect(cookieValue(readCookies(res.headers['set-cookie']), 'rt')).toBeTruthy();
    });

    it('answers the same way for a wrong password and an unknown email', async () => {
      const user = await registerUser(t.url);
      const wrongPassword = await request(t.url)
        .post('/api/auth/login')
        .send({ email: user.user.email, password: 'wrong-password' })
        .expect(401);
      const unknownEmail = await request(t.url)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password' })
        .expect(401);
      expect(wrongPassword.body.message).toBe('Invalid email or password');
      expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
    });
  });

  describe('access token', () => {
    it('protects private routes', async () => {
      const user = await registerUser(t.url);
      await request(t.url).get('/api/auth/me').expect(401);
      await request(t.url).get('/api/auth/me').set('Authorization', 'Bearer garbage').expect(401);
      const me = await request(t.url).get('/api/auth/me').set(user.auth).expect(200);
      expect(me.body).toEqual(user.user);
    });

    it('keeps access tokens and story media tokens apart', async () => {
      const user = await registerUser(t.url);
      const story = (
        await request(t.url)
          .post('/api/stories')
          .set(user.auth)
          .field('durationMs', '5000')
          .attach('video', fakeWebm(), { filename: 'a.webm', contentType: 'video/webm' })
          .expect(201)
      ).body as StoryDto;

      const { videoUrl } = (
        await request(t.url).get(`/api/stories/${story.id}/playback`).set(user.auth).expect(200)
      ).body as StoryPlaybackDto;
      const mediaToken = new URL(videoUrl, t.url).searchParams.get('token')!;
      await request(t.url)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${mediaToken}`)
        .expect(401);

      const accessToken = t.app
        .get(JwtService)
        .sign({ story: story.id }, { subject: user.user.id, audience: 'access', expiresIn: 60 });
      await request(t.url)
        .get(`/api/stories/${story.id}/video`)
        .query({ token: accessToken })
        .expect(401);
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token on every call', async () => {
      const user = await registerUser(t.url);
      const res = await refresh(user.cookies).expect(200);
      const next = readCookies(res.headers['set-cookie']);

      expect(res.body.user.id).toBe(user.user.id);
      expect(cookieValue(next, 'rt')).not.toBe(cookieValue(user.cookies, 'rt'));
      await refresh(next).expect(200);
    });

    it('lets concurrent refreshes with the same token succeed (two tabs)', async () => {
      const user = await registerUser(t.url);
      const results = await Promise.all([refresh(user.cookies), refresh(user.cookies)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      for (const r of results) {
        await refresh(readCookies(r.headers['set-cookie'])).expect(200);
      }
    });

    it('revokes the whole session family when an old token is replayed', async () => {
      const user = await registerUser(t.url);
      const rotated = await refresh(user.cookies).expect(200);
      const current = readCookies(rotated.headers['set-cookie']);

      // Move the rotation out of the grace window instead of waiting for it.
      await t.connection
        .collection('sessions')
        .updateMany(
          { userId: new Types.ObjectId(user.user.id), rotatedAt: { $ne: null } },
          { $set: { rotatedAt: new Date(Date.now() - 60_000) } },
        );

      const replay = await refresh(user.cookies).expect(401);
      expect(readCookies(replay.headers['set-cookie'])).toContain('rt=');
      await refresh(current).expect(401);
    });

    it('rejects an expired token', async () => {
      const user = await registerUser(t.url);
      await t.connection
        .collection('sessions')
        .updateOne(
          { userId: new Types.ObjectId(user.user.id) },
          { $set: { expiresAt: new Date(Date.now() - 1000) } },
        );
      await refresh(user.cookies).expect(401);
    });

    it('keeps the session when the check itself fails', async () => {
      const user = await registerUser(t.url);
      vi.spyOn(t.app.get(AuthService), 'refresh').mockRejectedValueOnce(new Error('db is down'));

      const failed = await refresh(user.cookies).expect(500);

      expect(failed.headers['set-cookie']).toBeUndefined();
      await refresh(user.cookies).expect(200);
    });

    it('rejects a missing or unknown token', async () => {
      await request(t.url).post('/api/auth/refresh').expect(401);
      await refresh(['rt=unknown']).expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the session and clears cookies', async () => {
      const user = await registerUser(t.url);
      const res = await request(t.url)
        .post('/api/auth/logout')
        .set('Cookie', user.cookies)
        .expect(204);
      expect(readCookies(res.headers['set-cookie'])).toEqual(
        expect.arrayContaining(['rt=', 'sid=']),
      );
      await refresh(user.cookies).expect(401);
    });

    it('is harmless without a session', async () => {
      await request(t.url).post('/api/auth/logout').expect(204);
    });
  });
});
