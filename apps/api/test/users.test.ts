import type { Page, UserDto } from '@chat/shared';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app.js';
import { registerUser, type TestUser } from './helpers/users.js';

describe('users', () => {
  let t: TestApp;
  let viewer: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    viewer = await registerUser(t.url, 'viewer');
    for (const name of ['Anna', 'anton', 'Boris', 'bella', 'carl', 'a.dot', 'a_under']) {
      await registerUser(t.url, name);
    }
  });

  afterAll(async () => {
    await t.close();
  });

  const list = (query: Record<string, string | number>) =>
    request(t.url).get('/api/users').query(query).set(viewer.auth);

  it('lists everyone but the viewer, alphabetically and case-insensitively', async () => {
    const res = await list({}).expect(200);
    const names = (res.body as Page<UserDto>).items.map((u) => u.username);
    expect(names).toEqual(['a.dot', 'a_under', 'Anna', 'anton', 'bella', 'Boris', 'carl']);
    expect(res.body.nextCursor).toBeNull();
  });

  it('pages through the list without gaps or duplicates', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await list({ limit: 3, ...(cursor && { cursor }) }).expect(200);
      const page = res.body as Page<UserDto>;
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((u) => u.username));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['a.dot', 'a_under', 'Anna', 'anton', 'bella', 'Boris', 'carl']);
  });

  it('searches by username prefix, ignoring case', async () => {
    const res = await list({ q: 'AN' }).expect(200);
    expect(res.body.items.map((u: UserDto) => u.username)).toEqual(['Anna', 'anton']);
  });

  it('treats regex characters in the query literally', async () => {
    const dot = await list({ q: 'a.' }).expect(200);
    expect(dot.body.items.map((u: UserDto) => u.username)).toEqual(['a.dot']);
    const wildcard = await list({ q: '.*' }).expect(200);
    expect(wildcard.body.items).toEqual([]);
  });

  it('never returns emails of other users', async () => {
    const res = await list({}).expect(200);
    for (const user of res.body.items) {
      expect(Object.keys(user).sort()).toEqual(['createdAt', 'id', 'username']);
    }
  });

  it('validates query parameters', async () => {
    await list({ limit: 0 }).expect(400);
    await list({ limit: 1000 }).expect(400);
    await list({ unknown: 1 }).expect(400);
  });

  it('answers 400, not 500, to a search with control characters', async () => {
    await list({ q: 'a\u0000b' }).expect(400);
  });
});
