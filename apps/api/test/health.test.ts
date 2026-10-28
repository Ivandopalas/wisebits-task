import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app.js';

describe('health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('reports liveness without touching the database', async () => {
    const res = await request(t.url).get('/api/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports readiness with a database ping', async () => {
    const res = await request(t.url).get('/api/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info.mongo.status).toBe('up');
  });

  it('echoes a valid request id and generates one otherwise', async () => {
    const echoed = await request(t.url).get('/api/health/live').set('X-Request-Id', 'abc-123');
    expect(echoed.headers['x-request-id']).toBe('abc-123');

    const generated = await request(t.url).get('/api/health/live').set('X-Request-Id', 'bad id!');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns unknown routes in the common error format', async () => {
    const res = await request(t.url).get('/api/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    expect(res.body.requestId).toBeTruthy();
  });

  it('rejects oversized JSON bodies in the common error format', async () => {
    const res = await request(t.url)
      .post('/api/auth/login')
      .set('X-Request-Id', 'big-body')
      .send({ email: 'a@b.co', password: 'x'.repeat(200_000) })
      .expect(413);
    expect(res.body).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      requestId: 'big-body',
    });
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(t.url).get('/api/docs-json').expect(200);
    expect(res.body.info.title).toBe('Realtime Chat API');
  });
});
