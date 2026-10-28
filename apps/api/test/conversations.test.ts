import type { ConversationDto, Page } from '@chat/shared';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app.js';
import { registerUser, type TestUser } from './helpers/users.js';

describe('conversations', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  const open = (user: TestUser, peer: TestUser) =>
    request(t.url).post('/api/conversations').set(user.auth).send({ userId: peer.user.id });

  const list = (user: TestUser, query: Record<string, string | number> = {}) =>
    request(t.url).get('/api/conversations').query(query).set(user.auth);

  const send = (user: TestUser, conversationId: string, text: string) =>
    request(t.url)
      .post(`/api/conversations/${conversationId}/messages`)
      .set(user.auth)
      .send({ text, clientMessageId: randomUUID() })
      .expect(201);

  it('creates a conversation once and returns the same one afterwards, from either side', async () => {
    const [alice, bob] = await Promise.all([registerUser(t.url), registerUser(t.url)]);

    const first = await open(alice, bob).expect(201);
    expect(first.body).toMatchObject({
      peer: { id: bob.user.id, username: bob.user.username },
      lastMessage: null,
      unreadCount: 0,
    });

    const again = await open(alice, bob).expect(200);
    const fromBob = await open(bob, alice).expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(fromBob.body.id).toBe(first.body.id);
    expect(fromBob.body.peer.id).toBe(alice.user.id);
  });

  it('survives a burst of concurrent opens from both users: exactly one conversation', async () => {
    const [alice, bob] = await Promise.all([registerUser(t.url), registerUser(t.url)]);
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? open(alice, bob) : open(bob, alice))),
    );

    expect(responses.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    const stored = await t.connection.collection('conversations').countDocuments({
      participants: { $all: [alice.user.id, bob.user.id].map((id) => new Types.ObjectId(id)) },
    });
    expect(stored).toBe(1);
  });

  it('refuses a conversation with yourself or with a missing user', async () => {
    const alice = await registerUser(t.url);
    await open(alice, alice).expect(400);
    await request(t.url)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ userId: '0123456789abcdef01234567' })
      .expect(404);
    await request(t.url)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ userId: 'x' })
      .expect(400);
  });

  it('shows an empty conversation only to the user who opened it', async () => {
    const [alice, bob] = await Promise.all([registerUser(t.url), registerUser(t.url)]);
    const conversation = (await open(alice, bob).expect(201)).body as ConversationDto;

    expect((await list(alice)).body.items.map((c: ConversationDto) => c.id)).toEqual([
      conversation.id,
    ]);
    expect((await list(bob)).body.items).toEqual([]);

    await send(alice, conversation.id, 'hello');
    const bobsList = (await list(bob)).body as Page<ConversationDto>;
    expect(bobsList.items).toHaveLength(1);
    expect(bobsList.items[0]).toMatchObject({
      id: conversation.id,
      peer: { id: alice.user.id },
      lastMessage: { text: 'hello', senderId: alice.user.id, seq: 1 },
      unreadCount: 1,
    });
  });

  it('orders by latest activity and pages with a cursor', async () => {
    const me = await registerUser(t.url);
    const peers = await Promise.all(Array.from({ length: 5 }, () => registerUser(t.url)));
    const ids: string[] = [];
    for (const peer of peers) {
      const c = (await open(me, peer).expect(201)).body as ConversationDto;
      ids.push(c.id);
    }
    // A message lifts the oldest conversation to the top.
    await send(peers[0]!, ids[0]!, 'bump');

    const expected = [ids[0], ids[4], ids[3], ids[2], ids[1]];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<ConversationDto> = (
        await list(me, { limit: 2, ...(cursor && { cursor }) }).expect(200)
      ).body;
      seen.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(expected);
  });

  it('lets only participants read a conversation', async () => {
    const [alice, bob, eve] = await Promise.all([
      registerUser(t.url),
      registerUser(t.url),
      registerUser(t.url),
    ]);
    const conversation = (await open(alice, bob).expect(201)).body as ConversationDto;
    await request(t.url).get(`/api/conversations/${conversation.id}`).set(bob.auth).expect(200);
    await request(t.url).get(`/api/conversations/${conversation.id}`).set(eve.auth).expect(403);
    await request(t.url)
      .get('/api/conversations/0123456789abcdef01234567')
      .set(eve.auth)
      .expect(404);
  });

  it('rejects a malformed cursor', async () => {
    const me = await registerUser(t.url);
    await list(me, { cursor: 'garbage' }).expect(400);
  });
});
