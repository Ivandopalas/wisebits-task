import type { AckResponse, ConversationDto, MessageDto } from '@chat/shared';
import { createAdapter, type MongoAdapter } from '@socket.io/mongo-adapter';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import request from 'supertest';
import { ADAPTER_COLLECTION } from '../src/realtime/mongo-io.adapter.js';
import { RealtimeService } from '../src/realtime/realtime.service.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import {
  connect,
  disconnectAll,
  nextDisconnect,
  nextEvent,
  type ClientSocket,
} from './helpers/sockets.js';
import { registerUser } from './helpers/users.js';
import { fakeWebm } from './helpers/videos.js';

/**
 * Two API instances on one database, like the two replicas behind nginx. Every client talks to
 * "its" instance only; whatever crosses over goes through the MongoDB adapter.
 */
describe('two API instances', () => {
  let one: TestApp;
  let two: TestApp;

  beforeAll(async () => {
    one = await createTestApp();
    two = await createTestApp();
  });

  afterEach(() => disconnectAll());

  afterAll(async () => {
    await Promise.all([one.close(), two.close()]);
  });

  async function setup() {
    const alice = await registerUser(one.url);
    const bob = await registerUser(two.url);
    const conversation = (
      await request(one.url)
        .post('/api/conversations')
        .set(alice.auth)
        .send({ userId: bob.user.id })
    ).body as ConversationDto;
    const aliceSocket = await connect(one.url, alice.accessToken);
    const bobSocket = await connect(two.url, bob.accessToken);
    return { alice, bob, conversationId: conversation.id, aliceSocket, bobSocket };
  }

  it('delivers messages, read receipts and typing between instances', async () => {
    const { alice, bob, conversationId, aliceSocket, bobSocket } = await setup();

    const delivered = nextEvent(bobSocket, 'message:new', 5000);
    const ack = (await aliceSocket.emitWithAck('message:send', {
      conversationId,
      text: 'hello across instances',
      clientMessageId: randomUUID(),
    })) as AckResponse<MessageDto>;
    expect(ack.ok).toBe(true);
    expect((await delivered).message.text).toBe('hello across instances');

    const receipt = nextEvent(aliceSocket, 'conversation:read', 5000);
    await bobSocket.emitWithAck('conversation:read', { conversationId, seq: 1 });
    expect(await receipt).toEqual({ conversationId, userId: bob.user.id, seq: 1 });

    const typing = nextEvent(bobSocket, 'typing', 5000);
    aliceSocket.emit('typing', { conversationId, isTyping: true });
    expect(await typing).toMatchObject({ userId: alice.user.id, isTyping: true });
  });

  it('delivers a message on the retry when the instance that stored it died before the emit', async () => {
    const { alice, conversationId, bobSocket } = await setup();
    const clientMessageId = randomUUID();
    const send = (socket: ClientSocket) =>
      socket.emitWithAck('message:send', {
        conversationId,
        text: 'ack lost',
        clientMessageId,
      }) as Promise<AckResponse<MessageDto>>;

    // Committed, but the instance goes down before anyone hears of it, its ack included.
    const dying = vi.spyOn(one.app.get(RealtimeService), 'emitToUsers').mockReturnValue(undefined);
    const firstSocket = await connect(one.url, alice.accessToken);
    const first = await send(firstSocket);
    expect(first.ok).toBe(true);
    dying.mockRestore();

    // The client reconnects to a surviving instance and retries with the same id.
    const delivered = nextEvent(bobSocket, 'message:new', 5000);
    const retrySocket = await connect(two.url, alice.accessToken);
    expect(await send(retrySocket)).toEqual(first);
    expect((await delivered).message).toEqual(first.ok && first.data);
  });

  it('answers presence for users connected to the other instance', async () => {
    const { bob, aliceSocket } = await setup();
    // Instances discover each other through heartbeats on the adapter collection.
    await expect
      .poll(async () => {
        const res = await aliceSocket.emitWithAck('presence:query', { userIds: [bob.user.id] });
        return res.ok ? res.data[bob.user.id] : undefined;
      })
      .toBe(true);
  });

  it('announces presence changes across instances', async () => {
    const alice = await registerUser(one.url);
    const bob = await registerUser(two.url);
    await request(one.url).post('/api/conversations').set(alice.auth).send({ userId: bob.user.id });
    const aliceSocket = await connect(one.url, alice.accessToken);

    const online = nextEvent(aliceSocket, 'presence', 5000, (e) => e.userId === bob.user.id);
    const bobSocket = await connect(two.url, bob.accessToken);
    expect(await online).toEqual({ userId: bob.user.id, online: true });

    const offline = nextEvent(aliceSocket, 'presence', 8000, (e) => e.userId === bob.user.id);
    bobSocket.disconnect();
    expect(await offline).toEqual({ userId: bob.user.id, online: false });
  });

  it('broadcasts new stories to every instance', async () => {
    const { aliceSocket, bob } = await setup();
    const announced = nextEvent(aliceSocket, 'story:created', 5000);
    await request(two.url)
      .post('/api/stories')
      .set(bob.auth)
      .field('durationMs', '5000')
      .attach('video', fakeWebm(), { filename: 'a.webm', contentType: 'video/webm' })
      .expect(201);
    expect((await announced).authorId).toBe(bob.user.id);
  });

  it('shares the session: a token issued by one instance works on the other', async () => {
    const user = await registerUser(one.url);
    await request(two.url).get('/api/auth/me').set(user.auth).expect(200);
    const refreshed = await request(two.url)
      .post('/api/auth/refresh')
      .set('Cookie', user.cookies)
      .expect(200);
    expect(refreshed.body.user.id).toBe(user.user.id);
  });

  it('ends a session on every instance: logout on one closes its sockets on the other', async () => {
    const user = await registerUser(one.url);
    const socket = await connect(two.url, user.accessToken);

    const closed = nextDisconnect(socket, 5000);
    await request(one.url).post('/api/auth/logout').set('Cookie', user.cookies).expect(204);
    expect(await closed).toBe('io server disconnect');
  });

  // Runs last: the instances keep counting the silent node for the rest of the file.
  it('keeps presence right while an instance has stopped answering', async () => {
    const { alice, bob, conversationId, aliceSocket, bobSocket } = await setup();
    await expect
      .poll(async () => {
        const res = await aliceSocket.emitWithAck('presence:query', { userIds: [bob.user.id] });
        return res.ok ? res.data[bob.user.id] : undefined;
      })
      .toBe(true);

    // A node that the others see through its heartbeats but that answers nothing: what an
    // instance looks like to the rest of the cluster in the seconds after it crashes.
    const silent = new Server();
    silent.adapter(
      createAdapter(one.connection.db!.collection(ADAPTER_COLLECTION), {
        heartbeatInterval: 1000,
      }),
    );
    const silentAdapter = silent.of('/').adapter as MongoAdapter;
    silentAdapter.onEvent = async () => undefined;
    // Give the others a heartbeat to learn about it.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    try {
      const startedAt = Date.now();
      const res = await aliceSocket.emitWithAck('presence:query', {
        userIds: [alice.user.id, bob.user.id],
      });
      expect(res).toEqual({ ok: true, data: { [alice.user.id]: true, [bob.user.id]: true } });
      expect(Date.now() - startedAt).toBeLessThan(4000);

      // Bob leaves; the instance he was on still works out that he is offline and says so.
      const offline = nextEvent(aliceSocket, 'presence', 10_000, (e) => e.userId === bob.user.id);
      bobSocket.disconnect();
      expect(await offline).toEqual({ userId: bob.user.id, online: false });

      // Messages never depended on the silent node.
      const delivered = nextEvent(aliceSocket, 'message:new', 5000);
      await request(two.url)
        .post(`/api/conversations/${conversationId}/messages`)
        .set(bob.auth)
        .send({ text: 'still here', clientMessageId: randomUUID() })
        .expect(201);
      expect((await delivered).message.text).toBe('still here');
    } finally {
      await silentAdapter.close();
    }
  });
});
