import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError, useSession } from './http.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api', () => {
  afterEach(() => useSession(null));

  it('sends the access token and parses JSON', async () => {
    useSession({ token: () => 't1', refresh: async () => null });
    const fetch = vi.fn(async () => json(200, { ok: true }));
    await expect(api('/things', { fetch, query: { q: 'a b', empty: '' } })).resolves.toEqual({
      ok: true,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/things?q=a+b');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t1');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const refresh = vi.fn(async () => 't2');
    useSession({ token: () => 't1', refresh });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(401, { statusCode: 401, error: 'Unauthorized', message: 'expired' }),
      )
      .mockResolvedValueOnce(json(200, { ok: true }));

    await expect(api('/things', { fetch })).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[1]![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer t2',
    });
  });

  it('surfaces the API error with field details', async () => {
    useSession(null);
    const fetch = vi.fn(async () =>
      json(409, {
        statusCode: 409,
        error: 'Conflict',
        message: 'This username is taken',
        details: [{ path: 'username', message: 'Already taken' }],
      }),
    );
    const error = (await api('/auth/register', { method: 'POST', body: {}, fetch }).catch(
      (e: unknown) => e,
    )) as ApiRequestError;
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(409);
    expect(error.fieldErrors).toEqual({ username: 'Already taken' });
  });

  it('explains errors that come from the proxy rather than the API', async () => {
    const html = (status: number) => new Response('<html>nginx</html>', { status });
    const message = (status: number) =>
      api('/things', { fetch: vi.fn(async () => html(status)) }).catch(
        (e: ApiRequestError) => e.message,
      );
    await expect(message(429)).resolves.toBe('Too many attempts. Wait a minute and try again.');
    await expect(message(502)).resolves.toBe(
      'The server is not available right now. Try again in a moment.',
    );
  });

  it('turns a network failure into a readable error', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(api('/things', { fetch })).rejects.toMatchObject({ status: 0 });
  });

  it('does not refresh for sign-in requests', async () => {
    const refresh = vi.fn(async () => 't2');
    useSession({ token: () => null, refresh });
    const fetch = vi.fn(async () =>
      json(401, { statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' }),
    );
    await expect(
      api('/auth/login', { method: 'POST', body: {}, fetch, anonymous: true }),
    ).rejects.toThrow('Invalid email or password');
    expect(refresh).not.toHaveBeenCalled();
  });
});
