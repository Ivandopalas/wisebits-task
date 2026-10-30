import { getModelToken } from '@nestjs/mongoose';
import type { StoryDto, StoryFeedItem } from '@chat/shared';
import { Types, type Model } from 'mongoose';
import request from 'supertest';
import { VideoStorage } from '../src/storage/video-storage.js';
import { StoriesCleanupJob } from '../src/stories/stories-cleanup.job.js';
import { FEED_LIMIT } from '../src/stories/stories.service.js';
import { Story } from '../src/stories/story.schema.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { connect, disconnectAll, nextEvent } from './helpers/sockets.js';
import { registerUser, type TestUser } from './helpers/users.js';
import { fakeMp4, fakePng, fakeWebm } from './helpers/videos.js';

describe('stories', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterEach(() => disconnectAll());

  afterAll(async () => {
    await t.close();
  });

  const upload = (
    user: TestUser,
    video: Buffer | null,
    { durationMs = '9000', filename = 'story.webm', contentType = 'video/webm' } = {},
  ) => {
    const req = request(t.url).post('/api/stories').set(user.auth).field('durationMs', durationMs);
    return video ? req.attach('video', video, { filename, contentType }) : req;
  };

  const feed = async (user: TestUser) =>
    (await request(t.url).get('/api/stories/feed').set(user.auth).expect(200))
      .body as StoryFeedItem[];

  const bucketFiles = () => t.connection.collection('videos.files');

  const getVideo = (url: string, range?: string) => {
    const req = request(t.url)
      .get(url)
      .buffer(true)
      .parse(readBinary as never);
    return range ? req.set('Range', range) : req;
  };

  describe('upload', () => {
    it('accepts WebM and MP4, detected by signature', async () => {
      const user = await registerUser(t.url);
      const webm = (await upload(user, fakeWebm()).expect(201)).body as StoryDto;
      expect(webm).toMatchObject({
        authorId: user.user.id,
        mimeType: 'video/webm',
        durationMs: 9000,
        viewed: false,
      });
      expect(new Date(webm.expiresAt).getTime() - new Date(webm.createdAt).getTime()).toBe(
        86_400_000,
      );

      const mp4 = (
        await upload(user, fakeMp4(), { filename: 'story.mp4', contentType: 'video/mp4' }).expect(
          201,
        )
      ).body as StoryDto;
      expect(mp4.mimeType).toBe('video/mp4');
    });

    it('rejects a non-video file whatever MIME type it claims', async () => {
      const user = await registerUser(t.url);
      const res = await upload(user, fakePng()).expect(415);
      expect(res.body.message).toBe('Only WebM and MP4 videos are accepted');
      expect(await bucketFiles().countDocuments({ 'metadata.ownerId': user.user.id })).toBe(0);
    });

    it('enforces the size and duration limits', async () => {
      const user = await registerUser(t.url);
      await upload(user, fakeWebm(25 * 1024 * 1024 + 1)).expect(413);
      await upload(user, fakeWebm(), { durationMs: '16000' }).expect(400);
      await upload(user, fakeWebm(), { durationMs: '15400' }).expect(201);
      await upload(user, null).expect(400);
    });

    it('removes the stored video when the story itself cannot be saved', async () => {
      const user = await registerUser(t.url);
      vi.spyOn(t.app.get<Model<Story>>(getModelToken(Story.name)), 'create').mockRejectedValueOnce(
        new Error('write failed'),
      );
      await upload(user, fakeWebm()).expect(500);
      expect(await bucketFiles().countDocuments({ 'metadata.ownerId': user.user.id })).toBe(0);
    });

    it('requires authentication', async () => {
      await request(t.url).post('/api/stories').attach('video', fakeWebm(), 'a.webm').expect(401);
    });

    it('announces new stories to everyone online', async () => {
      const [author, watcher] = await Promise.all([registerUser(t.url), registerUser(t.url)]);
      const socket = await connect(t.url, watcher.accessToken);
      const announced = nextEvent(socket, 'story:created');
      const story = (await upload(author, fakeWebm()).expect(201)).body as StoryDto;
      expect(await announced).toEqual({ storyId: story.id, authorId: author.user.id });
    });
  });

  describe('feed', () => {
    it('lists my stories first, then unseen ones, and tracks views', async () => {
      const [me, seen, unseen] = await Promise.all([
        registerUser(t.url),
        registerUser(t.url),
        registerUser(t.url),
      ]);
      const seenStory = (await upload(seen, fakeWebm()).expect(201)).body as StoryDto;
      await upload(unseen, fakeWebm()).expect(201);
      await upload(me, fakeWebm()).expect(201);
      await request(t.url).post(`/api/stories/${seenStory.id}/view`).set(me.auth).expect(204);

      const items = (await feed(me)).filter((i) =>
        [me, seen, unseen].some((u) => u.user.id === i.author.id),
      );
      expect(items.map((i) => [i.author.id, i.hasUnseen])).toEqual([
        [me.user.id, false],
        [unseen.user.id, true],
        [seen.user.id, false],
      ]);
      expect(items[2]!.stories[0]!.viewed).toBe(true);
    });

    it('groups stories per author in the order they were posted', async () => {
      const [me, author] = await Promise.all([registerUser(t.url), registerUser(t.url)]);
      const first = (await upload(author, fakeWebm()).expect(201)).body as StoryDto;
      const second = (await upload(author, fakeMp4()).expect(201)).body as StoryDto;
      const item = (await feed(me)).find((i) => i.author.id === author.user.id)!;
      expect(item.stories.map((s) => s.id)).toEqual([first.id, second.id]);
    });

    it('keeps the newest stories when there are more than the feed takes', async () => {
      const [me, busy, fresh] = await Promise.all([
        registerUser(t.url),
        registerUser(t.url),
        registerUser(t.url),
      ]);
      const hourAgo = Date.now() - 3_600_000;
      await t.connection.collection('stories').insertMany(
        Array.from({ length: FEED_LIMIT }, (_, i) => ({
          authorId: new Types.ObjectId(busy.user.id),
          videoId: new Types.ObjectId().toString(),
          mimeType: 'video/webm',
          durationMs: 5000,
          sizeBytes: 1000,
          createdAt: new Date(hourAgo + i),
          expiresAt: new Date(hourAgo + i + 86_400_000),
        })),
      );
      const latest = (await upload(fresh, fakeWebm()).expect(201)).body as StoryDto;

      const items = await feed(me);
      expect(items.find((i) => i.author.id === fresh.user.id)?.stories[0]?.id).toBe(latest.id);
    });

    it('reads the newest stories off the index, without sorting them in memory', async () => {
      const user = await registerUser(t.url);
      await upload(user, fakeWebm()).expect(201);

      const db = t.connection.db!;
      await db.command({ profile: 2 });
      await feed(user);
      await db.command({ profile: 0 });

      const read = await db
        .collection('system.profile')
        .findOne({ ns: `${db.databaseName}.stories`, op: 'query' });
      expect(read?.planSummary).toBe('IXSCAN { expiresAt: 1 }');
      expect(read?.hasSortStage).toBeUndefined();
    });
  });

  describe('video playback', () => {
    it('serves the whole file and byte ranges', async () => {
      const user = await registerUser(t.url);
      const video = fakeWebm(10_000);
      const story = (await upload(user, video).expect(201)).body as StoryDto;

      const full = await getVideo(story.videoUrl).expect(200);
      expect(full.headers['content-type']).toBe('video/webm');
      expect(full.headers['accept-ranges']).toBe('bytes');
      expect(Buffer.compare(full.body as Buffer, video)).toBe(0);

      const part = await getVideo(story.videoUrl, 'bytes=100-199').expect(206);
      expect(part.headers['content-range']).toBe('bytes 100-199/10000');
      expect(part.headers['content-length']).toBe('100');
      expect(Buffer.compare(part.body as Buffer, video.subarray(100, 200))).toBe(0);

      const tail = await getVideo(story.videoUrl, 'bytes=-10').expect(206);
      expect(Buffer.compare(tail.body as Buffer, video.subarray(-10))).toBe(0);

      const outside = await request(t.url)
        .get(story.videoUrl)
        .set('Range', 'bytes=20000-')
        .expect(416);
      expect(outside.headers['content-range']).toBe('bytes */10000');
    });

    it('needs a valid media token for this very story', async () => {
      const user = await registerUser(t.url);
      const a = (await upload(user, fakeWebm()).expect(201)).body as StoryDto;
      const b = (await upload(user, fakeWebm()).expect(201)).body as StoryDto;
      const tokenOfB = new URL(b.videoUrl, t.url).searchParams.get('token')!;

      await request(t.url).get(`/api/stories/${a.id}/video`).expect(400);
      await request(t.url).get(`/api/stories/${a.id}/video?token=garbage`).expect(401);
      await request(t.url).get(`/api/stories/${a.id}/video?token=${tokenOfB}`).expect(401);
      // An access token is signed with the same key but has a different audience.
      await request(t.url).get(`/api/stories/${a.id}/video?token=${user.accessToken}`).expect(401);
    });
  });

  describe('expiry', () => {
    it('never serves an expired story, even before the TTL monitor removes it', async () => {
      const [author, viewer] = await Promise.all([registerUser(t.url), registerUser(t.url)]);
      const story = (await upload(author, fakeWebm()).expect(201)).body as StoryDto;
      await t.connection
        .collection('stories')
        .updateOne(
          { _id: new Types.ObjectId(story.id) },
          { $set: { expiresAt: new Date(Date.now() - 1000) } },
        );

      expect((await feed(viewer)).some((i) => i.stories.some((s) => s.id === story.id))).toBe(
        false,
      );
      await request(t.url).get(story.videoUrl).expect(404);
      await request(t.url).post(`/api/stories/${story.id}/view`).set(viewer.auth).expect(404);
    });

    it('cleans up expired video files, idempotently, and keeps live ones', async () => {
      const user = await registerUser(t.url);
      const expired = (await upload(user, fakeWebm()).expect(201)).body as StoryDto;
      const live = (await upload(user, fakeWebm()).expect(201)).body as StoryDto;
      const videoIdOf = async (id: string) =>
        (await t.connection.collection('stories').findOne({ _id: new Types.ObjectId(id) }))!
          .videoId as string;
      const expiredVideo = await videoIdOf(expired.id);
      const liveVideo = await videoIdOf(live.id);

      const job = t.app.get(StoriesCleanupJob);
      const later = new Date(Date.now() + 86_400_000 + 1000);
      await bucketFiles().updateOne(
        { _id: new Types.ObjectId(liveVideo) },
        { $set: { 'metadata.expiresAt': new Date(later.getTime() + 60_000) } },
      );

      // Both replicas run the job; each file is removed, and counted, exactly once.
      const due = await bucketFiles().countDocuments({ 'metadata.expiresAt': { $lte: later } });
      const [byJob, byOtherReplica] = await Promise.all([
        job.run(later),
        t.app.get(VideoStorage).deleteExpired(later),
      ]);
      expect(byJob + byOtherReplica).toBe(due);
      expect(await bucketFiles().countDocuments({ _id: new Types.ObjectId(expiredVideo) })).toBe(0);
      expect(
        await t.connection
          .collection('videos.chunks')
          .countDocuments({ files_id: new Types.ObjectId(expiredVideo) }),
      ).toBe(0);
      expect(await bucketFiles().countDocuments({ _id: new Types.ObjectId(liveVideo) })).toBe(1);

      await expect(job.run(later)).resolves.toBe(0);
    });

    it('relies on a TTL index for documents', async () => {
      const indexes = await t.connection.collection('stories').indexes();
      expect(indexes.find((i) => i.key.expiresAt === 1)?.expireAfterSeconds).toBe(0);
    });
  });

  describe('delete', () => {
    it('lets authors delete their own stories, files included', async () => {
      const [author, other] = await Promise.all([registerUser(t.url), registerUser(t.url)]);
      const story = (await upload(author, fakeWebm()).expect(201)).body as StoryDto;
      const { videoId } = (await t.connection
        .collection('stories')
        .findOne({ _id: new Types.ObjectId(story.id) }))!;

      await request(t.url).delete(`/api/stories/${story.id}`).set(other.auth).expect(403);
      await request(t.url).delete(`/api/stories/${story.id}`).set(author.auth).expect(204);

      expect(
        await bucketFiles().countDocuments({ _id: new Types.ObjectId(videoId as string) }),
      ).toBe(0);
      expect((await feed(other)).some((i) => i.author.id === author.user.id)).toBe(false);
    });
  });
});

function readBinary(
  res: NodeJS.ReadableStream,
  done: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}
