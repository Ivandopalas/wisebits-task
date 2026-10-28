import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app.js';

describe('auth rate limit', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
  });

  afterAll(async () => {
    await t.close();
  });

  it('throttles repeated login attempts from one client', async () => {
    const attempt = () =>
      request(t.url)
        .post('/api/auth/login')
        .send({ email: 'a@example.com', password: 'nope-nope' });

    for (let i = 0; i < 3; i += 1) {
      await attempt().expect(401);
    }
    const blocked = await attempt().expect(429);
    expect(blocked.body).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
    expect(Object.keys(blocked.headers).some((h) => h.startsWith('retry-after'))).toBe(true);
  });
});
