import type { AckResponse, ConversationDto, MessageDto, MessagesPage } from '@chat/shared';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app.js';
import {
  connect,
  connectError,
  disconnectAll,
  nextEvent,
  noEvent,
  type ClientSocket,
} from './helpers/sockets.js';
import { registerUser, type TestUser } from './helpers/users.js';

describe('chat gateway', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterEach(() => {
    disconnectAll();
  });

  afterAll(async () => {
    await t.close();
  });

  async function pair() {
    const [alice, bob] = await Promise.all([registerUser(t.url), registerUser(t.url)]);
    const res = await request(t.url)
      .post('/api/conversations')
      .set(alice.auth)
      .send({ userId: bob.user.id });
    return { alice, bob, conversationId: (res.body as ConversationDto).id };
  }

  const join = (user: TestUser) => connect(t.url, user.accessToken);

  const sendOver = (
    socket: ClientSocket,
    conversationId: string,
    text: string,
    clientMessageId = randomUUID(),
  ) =>
    socket.emitWithAck('message:send', { conversationId, text, clientMessageId }) as Promise<
      AckResponse<MessageDto>
    >;

  describe('handshake', () => {
    it('rejects a missing or invalid token', async () => {
      expect(await connectError(t.url)).toMatchObject({ code: 'UNAUTHORIZED' });
      expect(await connectError(t.url, 'garbage')).toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('tells the client when the token expired so it can refresh and retry', async () => {
      const user = await registerUser(t.url);
      const expired = t.app
        .get(JwtService)
        .sign(
          { username: user.user.username },
          { subject: user.user.id, audience: 'access', expiresIn: -10 },
        );
      expect(await connectError(t.url, expired)).toMatchObject({ code: 'TOKEN_EXPIRED' });
    });

    it('rejects a valid token of a user that no longer exists', async () => {
      const user = await registerUser(t.url);
      await t.connection.collection('users').deleteOne({ _id: new Types.ObjectId(user.user.id) });
      expect(await connectError(t.url, user.accessToken)).toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  describe('messages', () => {
    it("acks the sender and delivers to the peer and to the sender's other tabs", async () => {
      const { alice, bob, conversationId } = await pair();
      const [aliceTab1, aliceTab2, bobSocket] = await Promise.all([
        join(alice),
        join(alice),
        join(bob),
      ]);

      const toBob = nextEvent(bobSocket, 'message:new');
      const toAliceTab2 = nextEvent(aliceTab2, 'message:new');
      const ack = await sendOver(aliceTab1, conversationId, 'hi bob');

      expect(ack).toMatchObject({
        ok: true,
        data: { text: 'hi bob', seq: 1, senderId: alice.user.id },
      });
      const delivered = await toBob;
      expect(delivered.message).toEqual(ack.ok && ack.data);
      expect(delivered.conversation).toMatchObject({
        id: conversationId,
        peer: { id: alice.user.id },
        unreadCount: 1,
      });
      const mirrored = await toAliceTab2;
      expect(mirrored.conversation).toMatchObject({ peer: { id: bob.user.id }, unreadCount: 0 });
    });

    it('stores a retried send once and delivers the same message again', async () => {
      const { alice, bob, conversationId } = await pair();
      const [aliceSocket, bobSocket] = await Promise.all([join(alice), join(bob)]);
      const clientMessageId = randomUUID();

      const delivered = nextEvent(bobSocket, 'message:new');
      const first = await sendOver(aliceSocket, conversationId, 'once', clientMessageId);
      const original = await delivered;

      const redelivered = nextEvent(bobSocket, 'message:new');
      const retry = await sendOver(aliceSocket, conversationId, 'once', clientMessageId);
      expect(retry).toEqual(first);
      expect(await redelivered).toEqual(original);

      const res = await request(t.url)
        .get(`/api/conversations/${conversationId}/messages`)
        .set(alice.auth)
        .expect(200);
      expect((res.body as MessagesPage).items).toHaveLength(1);
    });

    it('answers errors through the ack in the REST error format', async () => {
      const { conversationId } = await pair();
      const eve = await registerUser(t.url);
      const eveSocket = await join(eve);

      const forbidden = await sendOver(eveSocket, conversationId, 'let me in');
      expect(forbidden).toMatchObject({
        ok: false,
        error: { statusCode: 403, error: 'Forbidden' },
      });

      const invalid = (await eveSocket.emitWithAck('message:send', {
        conversationId: 'nope',
        text: '',
        clientMessageId: 'x',
      } as never)) as AckResponse<MessageDto>;
      expect(invalid).toMatchObject({
        ok: false,
        error: { statusCode: 400, message: 'Validation failed' },
      });
      expect(!invalid.ok && (invalid.error.details as unknown[]).length).toBe(3);
    });

    it('pushes messages sent over REST to connected sockets', async () => {
      const { alice, bob, conversationId } = await pair();
      const bobSocket = await join(bob);
      const delivered = nextEvent(bobSocket, 'message:new');
      await request(t.url)
        .post(`/api/conversations/${conversationId}/messages`)
        .set(alice.auth)
        .send({ text: 'via rest', clientMessageId: randomUUID() })
        .expect(201);
      expect((await delivered).message.text).toBe('via rest');
    });

    it('stores sends that overlap in time in the order they were sent', async () => {
      const { alice, conversationId } = await pair();
      const sent: string[] = [];
      // The rate limit is per socket, so every burst gets its own connection.
      for (let burst = 0; burst < 3; burst++) {
        const socket = await join(alice);
        const texts = Array.from({ length: 8 }, (_, i) => `burst ${burst} #${i}`);
        sent.push(...texts);
        const acks = await Promise.all(texts.map((text) => sendOver(socket, conversationId, text)));
        expect(acks.every((ack) => ack.ok)).toBe(true);
      }

      const res = await request(t.url)
        .get(`/api/conversations/${conversationId}/messages`)
        .query({ limit: 50 })
        .set(alice.auth)
        .expect(200);
      const stored = (res.body as { items: MessageDto[] }).items;
      expect(stored.map((m) => m.text)).toEqual(sent);
      expect(stored.map((m) => m.seq)).toEqual(sent.map((_, i) => i + 1));
    });

    it('keeps sending after a send in the middle of a burst fails', async () => {
      const { alice, conversationId } = await pair();
      const foreign = await pair();
      const socket = await join(alice);
      const acks = await Promise.all([
        sendOver(socket, conversationId, 'first'),
        sendOver(socket, foreign.conversationId, 'not mine'),
        sendOver(socket, conversationId, 'second'),
      ]);
      expect(acks.map((ack) => ack.ok)).toEqual([true, false, true]);
      expect(acks[2]).toMatchObject({ ok: true, data: { text: 'second', seq: 2 } });
    });

    it('limits how fast one socket can send', async () => {
      const { alice, conversationId } = await pair();
      const socket = await join(alice);
      const acks = await Promise.all(
        Array.from({ length: 15 }, (_, i) => sendOver(socket, conversationId, `m${i}`)),
      );
      const rejected = acks.filter((a) => !a.ok);
      expect(rejected.length).toBeGreaterThan(0);
      expect(rejected[0]).toMatchObject({ ok: false, error: { statusCode: 429 } });
    });
  });

  describe('read receipts and typing', () => {
    it('notifies the sender when the peer reads', async () => {
      const { alice, bob, conversationId } = await pair();
      const [aliceSocket, bobSocket] = await Promise.all([join(alice), join(bob)]);
      await sendOver(aliceSocket, conversationId, 'read me');

      const receipt = nextEvent(aliceSocket, 'conversation:read');
      const ack = await bobSocket.emitWithAck('conversation:read', { conversationId, seq: 1 });
      expect(ack).toEqual({ ok: true, data: { seq: 1 } });
      expect(await receipt).toEqual({ conversationId, userId: bob.user.id, seq: 1 });
    });

    it('relays typing to the peer only', async () => {
      const { alice, bob, conversationId } = await pair();
      const [aliceTab1, aliceTab2, bobSocket] = await Promise.all([
        join(alice),
        join(alice),
        join(bob),
      ]);

      const atBob = nextEvent(bobSocket, 'typing');
      const atOwnTab = noEvent(aliceTab2, 'typing');
      aliceTab1.emit('typing', { conversationId, isTyping: true });

      expect(await atBob).toEqual({ conversationId, userId: alice.user.id, isTyping: true });
      expect(await atOwnTab).toBe(true);
    });
  });

  describe('presence', () => {
    it('reports who is online across all tabs', async () => {
      const { alice, bob } = await pair();
      const carol = await registerUser(t.url);
      const aliceSocket = await join(alice);
      await join(bob);

      const result = await aliceSocket.emitWithAck('presence:query', {
        userIds: [bob.user.id, carol.user.id],
      });
      expect(result).toEqual({ ok: true, data: { [bob.user.id]: true, [carol.user.id]: false } });
    });

    it('announces a partner going online and, after the last tab closes, offline', async () => {
      const { alice, bob } = await pair();
      const aliceSocket = await join(alice);

      const online = nextEvent(aliceSocket, 'presence', 3000, (e) => e.userId === bob.user.id);
      const bobTab1 = await join(bob);
      expect(await online).toEqual({ userId: bob.user.id, online: true });
      const bobTab2 = await join(bob);

      const stillOnline = noEvent(aliceSocket, 'presence', 3000, (e) => !e.online);
      bobTab1.disconnect();
      expect(await stillOnline).toBe(true);

      const offline = nextEvent(aliceSocket, 'presence', 5000, (e) => e.userId === bob.user.id);
      bobTab2.disconnect();
      expect(await offline).toEqual({ userId: bob.user.id, online: false });
    });
  });
});
