import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheckService } from '@nestjs/terminus';
import request from 'supertest';
import { UsersService } from '../src/users/users.service.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { registerUser } from './helpers/users.js';

describe('health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await t.close();
  });

  it('reports readiness with a database ping', async () => {
    const res = await request(t.url).get('/api/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info.mongo.status).toBe('up');
  });

  it('stops being ready but stays alive while the database does not answer', async () => {
    const ping = vi.spyOn(t.connection.db!, 'command').mockRejectedValue(new Error('no primary'));

    await request(t.url).get('/api/health/live').expect(200, { status: 'ok' });
    expect(ping).not.toHaveBeenCalled();

    await request(t.url).get('/api/health/ready').expect(503);
    expect(ping).toHaveBeenCalled();
  });

  it('does not report a readiness refusal during shutdown as an unhandled error', async () => {
    vi.spyOn(t.app.get(HealthCheckService), 'check').mockRejectedValueOnce(
      new ServiceUnavailableException({ status: 'shutting_down' }),
    );
    const logged = vi.spyOn(Logger.prototype, 'error');

    await request(t.url).get('/api/health/ready').expect(503);

    expect(logged).not.toHaveBeenCalled();
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

  it('keeps the text of an unexpected error in the logs, away from the client', async () => {
    const user = await registerUser(t.url);
    const failure = new Error('connect ECONNREFUSED mongodb://chat:s3cret@db:27017');
    vi.spyOn(t.app.get(UsersService), 'list').mockRejectedValueOnce(failure);
    const logged = vi.spyOn(Logger.prototype, 'error');

    const res = await request(t.url).get('/api/users').set(user.auth).expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
      requestId: expect.any(String),
    });
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      'Unhandled error',
    );
  });
});
