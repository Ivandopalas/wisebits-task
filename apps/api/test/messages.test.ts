import type { ConversationDto, MessageDto, MessagesPage } from '@chat/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app.js';
import { registerUser, type TestUser } from './helpers/users.js';

describe('messages', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  async function pair(): Promise<{ alice: TestUser; bob: TestUser; conversationId: string }> {
    const [alice, bob] = await Promise.all([registerUser(t.url), registerUser(t.url)]);
    const res = await request(t.url)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ userId: bob.user.id });
    return { alice, bob, conversationId: (res.body as ConversationDto).id };
  }

  const send = (
    user: TestUser,
    conversationId: string,
    text: string,
    clientMessageId = randomUUID(),
  ) =>
    request(t.url)
      .post(`/api/conversations/${conversationId}/messages`)
      .set(user.auth)
      .send({ text, clientMessageId });

  const history = (user: TestUser, conversationId: string, query: Record<string, number> = {}) =>
    request(t.url).get(`/api/conversations/${conversationId}/messages`).query(query).set(user.auth);

  const conversationOf = async (user: TestUser, conversationId: string) =>
    (await request(t.url).get(`/api/conversations/${conversationId}`).set(user.auth).expect(200))
      .body as ConversationDto;

  it('stores a message and updates preview and unread counters together', async () => {
    const { alice, bob, conversationId } = await pair();
    const res = await send(alice, conversationId, '  hello bob  ').expect(201);
    const message = res.body as MessageDto;
    expect(message).toMatchObject({
      conversationId,
      seq: 1,
      senderId: alice.user.id,
      text: 'hello bob',
    });

    const forBob = await conversationOf(bob, conversationId);
    expect(forBob.unreadCount).toBe(1);
    expect(forBob.lastMessage).toMatchObject({ id: message.id, text: 'hello bob', seq: 1 });
    expect((await conversationOf(alice, conversationId)).unreadCount).toBe(0);
  });

  it('assigns gapless sequence numbers under concurrent sends', async () => {
    const { alice, bob, conversationId } = await pair();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => send(i % 2 ? alice : bob, conversationId, `m${i}`)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const seqs = results.map((r) => (r.body as MessageDto).seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

    const page = (await history(alice, conversationId, { limit: 100 }).expect(200))
      .body as MessagesPage;
    expect(page.items.map((m) => m.seq)).toEqual(seqs);
    expect((await conversationOf(alice, conversationId)).lastMessage?.seq).toBe(20);
  });

  it('is idempotent per clientMessageId: a retry returns the stored message, no duplicate', async () => {
    const { alice, bob, conversationId } = await pair();
    const clientMessageId = randomUUID();

    const first = await send(alice, conversationId, 'once', clientMessageId).expect(201);
    const retry = await send(alice, conversationId, 'once', clientMessageId).expect(200);
    expect(retry.body).toEqual(first.body);

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => send(alice, conversationId, 'burst', randomUUID())),
    );
    const sameId = randomUUID();
    const racing = await Promise.all(
      Array.from({ length: 5 }, () => send(alice, conversationId, 'race', sameId)),
    );
    expect(new Set(racing.map((r) => r.body.id)).size).toBe(1);
    expect(racing.filter((r) => r.status === 201)).toHaveLength(1);

    const page = (await history(bob, conversationId, { limit: 100 }).expect(200))
      .body as MessagesPage;
    expect(page.items).toHaveLength(1 + concurrent.length + 1);
    expect((await conversationOf(bob, conversationId)).unreadCount).toBe(7);
  });

  it('refuses to reuse a clientMessageId in another conversation', async () => {
    const first = await pair();
    const carol = await registerUser(t.url);
    const other = await request(t.url)
      .post('/api/conversations')
      .set(first.alice.auth)
      .send({ userId: carol.user.id });
    const clientMessageId = randomUUID();
    await send(first.alice, first.conversationId, 'a', clientMessageId).expect(201);
    await send(first.alice, other.body.id, 'b', clientMessageId).expect(409);
  });

  it('keeps outsiders out', async () => {
    const { conversationId } = await pair();
    const eve = await registerUser(t.url);
    await send(eve, conversationId, 'let me in').expect(403);
    await history(eve, conversationId).expect(403);
    await request(t.url)
      .post(`/api/conversations/${conversationId}/read`)
      .set(eve.auth)
      .send({ seq: 1 })
      .expect(403);
  });

  it('validates the text', async () => {
    const { alice, conversationId } = await pair();
    await send(alice, conversationId, '   ').expect(400);
    await send(alice, conversationId, 'x'.repeat(4001)).expect(400);
    await send(alice, conversationId, 'x'.repeat(4000)).expect(201);
    await send(alice, conversationId, 'a\u0000b').expect(400);
    await request(t.url)
      .post(`/api/conversations/${conversationId}/messages`)
      .set(alice.auth)
      .send({ text: 'no id' })
      .expect(400);
  });

  it('pages backwards with "before" and catches up with "after"', async () => {
    const { alice, conversationId } = await pair();
    for (let i = 1; i <= 7; i += 1) {
      await send(alice, conversationId, `m${i}`).expect(201);
    }

    const latest = (await history(alice, conversationId, { limit: 3 }).expect(200))
      .body as MessagesPage;
    expect(latest.items.map((m) => m.seq)).toEqual([5, 6, 7]);
    expect(latest.hasMore).toBe(true);

    const older = (await history(alice, conversationId, { limit: 3, before: 5 }).expect(200))
      .body as MessagesPage;
    expect(older.items.map((m) => m.seq)).toEqual([2, 3, 4]);
    expect(older.hasMore).toBe(true);

    const oldest = (await history(alice, conversationId, { limit: 3, before: 2 }).expect(200))
      .body as MessagesPage;
    expect(oldest.items.map((m) => m.seq)).toEqual([1]);
    expect(oldest.hasMore).toBe(false);

    const missed = (await history(alice, conversationId, { after: 4, limit: 2 }).expect(200))
      .body as MessagesPage;
    expect(missed.items.map((m) => m.seq)).toEqual([5, 6]);
    expect(missed.hasMore).toBe(true);

    await request(t.url)
      .get(`/api/conversations/${conversationId}/messages?before=3&after=1`)
      .set(alice.auth)
      .expect(400);
  });

  describe('read state', () => {
    const markRead = (user: TestUser, conversationId: string, seq: number) =>
      request(t.url).post(`/api/conversations/${conversationId}/read`).set(user.auth).send({ seq });

    it('moves the read marker forward only and recomputes unread', async () => {
      const { alice, bob, conversationId } = await pair();
      for (let i = 1; i <= 4; i += 1) {
        await send(alice, conversationId, `m${i}`).expect(201);
      }

      expect((await markRead(bob, conversationId, 2).expect(200)).body).toEqual({ seq: 2 });
      expect((await conversationOf(bob, conversationId)).unreadCount).toBe(2);
      expect((await conversationOf(alice, conversationId)).peerLastReadSeq).toBe(2);

      expect((await markRead(bob, conversationId, 1).expect(200)).body).toEqual({ seq: 2 });
      expect((await markRead(bob, conversationId, 99).expect(200)).body).toEqual({ seq: 4 });
      expect((await conversationOf(bob, conversationId)).unreadCount).toBe(0);
    });

    it('rejects unknown fields', async () => {
      const { alice, bob, conversationId } = await pair();
      await send(alice, conversationId, 'hello').expect(201);
      await request(t.url)
        .post(`/api/conversations/${conversationId}/read`)
        .set(bob.auth)
        .send({ seq: 1, userId: alice.user.id })
        .expect(400);
    });

    it('treats a reply as having read the conversation', async () => {
      const { alice, bob, conversationId } = await pair();
      await send(alice, conversationId, 'question').expect(201);
      await send(bob, conversationId, 'answer').expect(201);
      expect((await conversationOf(bob, conversationId)).unreadCount).toBe(0);
      expect((await conversationOf(alice, conversationId)).peerLastReadSeq).toBe(2);
    });
  });
});
