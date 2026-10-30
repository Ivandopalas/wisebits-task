import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  LIMITS,
  STORY_MIME_TYPES,
  type StoryDto,
  type StoryFeedItem,
  type StoryMimeType,
  type StoryPlaybackDto,
} from '@chat/shared';
import { fileTypeFromBuffer } from 'file-type';
import { Model, Types } from 'mongoose';
import { TokensService } from '../auth/tokens.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { VideoStorage } from '../storage/video-storage.js';
import { toUserDto } from '../users/user.mapper.js';
import { UsersService } from '../users/users.service.js';
import { Story, StoryView } from './story.schema.js';

/** Live stories considered for the feed, newest first. */
export const FEED_LIMIT = 500;

@Injectable()
export class StoriesService {
  constructor(
    @InjectModel(Story.name) private readonly stories: Model<Story>,
    @InjectModel(StoryView.name) private readonly views: Model<StoryView>,
    private readonly storage: VideoStorage,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * The declared MIME type comes from the client and proves nothing; the file's own signature
   * decides. Duration is enforced by the recorder and checked as declared: measuring it would
   * mean probing the video on the server, which this project deliberately does not do.
   */
  async create(authorId: string, video: Buffer | undefined, durationMs: number): Promise<StoryDto> {
    if (!video || video.length === 0) {
      throw new BadRequestException('Attach a video file in the "video" field');
    }
    const detected = await fileTypeFromBuffer(video);
    const mimeType = detected?.mime as StoryMimeType | undefined;
    if (!mimeType || !STORY_MIME_TYPES.includes(mimeType)) {
      throw new UnsupportedMediaTypeException('Only WebM and MP4 videos are accepted');
    }

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + LIMITS.storyTtlMs);
    const stored = await this.storage.save({
      data: video,
      contentType: mimeType,
      ownerId: authorId,
      expiresAt,
    });

    let story: Story;
    try {
      const doc = await this.stories.create({
        authorId: new Types.ObjectId(authorId),
        videoId: stored.id,
        mimeType,
        durationMs,
        sizeBytes: stored.length,
        createdAt,
        expiresAt,
      });
      story = doc.toObject();
    } catch (error) {
      await this.storage.delete(stored.id);
      throw error;
    }

    this.realtime.emitToAll('story:created', { storyId: story._id.toString(), authorId });
    return this.toDto(story, false);
  }

  /** Authors with live stories: mine first, then those with something unseen, newest first. */
  async feed(viewerId: string): Promise<StoryFeedItem[]> {
    const now = new Date();
    // Every story lives the same time, so the last to expire are the newest, and the TTL index
    // hands them over in that order without a sort in memory.
    const newest = await this.stories
      .find({ expiresAt: { $gt: now } })
      .sort({ expiresAt: -1 })
      .limit(FEED_LIMIT)
      .lean()
      .exec();
    if (newest.length === 0) {
      return [];
    }
    // Each author's stories play oldest first.
    const stories = newest.reverse();

    const [authors, viewed] = await Promise.all([
      this.users.findByIds([...new Set(stories.map((s) => s.authorId.toString()))]),
      this.views
        .find({
          viewerId: new Types.ObjectId(viewerId),
          storyId: { $in: stories.map((s) => s._id) },
        })
        .lean()
        .exec(),
    ]);
    const viewedIds = new Set(viewed.map((v) => v.storyId.toString()));
    const authorsById = new Map(authors.map((a) => [a._id.toString(), a]));

    const byAuthor = new Map<string, Story[]>();
    for (const story of stories) {
      const key = story.authorId.toString();
      byAuthor.set(key, [...(byAuthor.get(key) ?? []), story]);
    }

    const items: StoryFeedItem[] = [];
    for (const [authorId, list] of byAuthor) {
      const author = authorsById.get(authorId);
      if (!author) {
        continue;
      }
      const dtos = list.map((s) =>
        this.toDto(s, authorId === viewerId || viewedIds.has(s._id.toString())),
      );
      items.push({
        author: toUserDto(author),
        stories: dtos,
        hasUnseen: dtos.some((s) => !s.viewed),
        latestAt: dtos[dtos.length - 1]!.createdAt,
      });
    }

    return items.sort(
      (a, b) =>
        Number(b.author.id === viewerId) - Number(a.author.id === viewerId) ||
        Number(b.hasUnseen) - Number(a.hasUnseen) ||
        b.latestAt.localeCompare(a.latestAt),
    );
  }

  async markViewed(storyId: string, viewerId: string): Promise<void> {
    const story = await this.findActive(storyId);
    await this.views.updateOne(
      { storyId: story._id, viewerId: new Types.ObjectId(viewerId) },
      { $setOnInsert: { expiresAt: story.expiresAt } },
      { upsert: true },
    );
  }

  async remove(storyId: string, userId: string): Promise<void> {
    const story = await this.findActive(storyId);
    if (!story.authorId.equals(userId)) {
      throw new ForbiddenException('You can only delete your own stories');
    }
    await this.stories.deleteOne({ _id: story._id });
    await Promise.all([
      this.storage.delete(story.videoId),
      this.views.deleteMany({ storyId: story._id }),
    ]);
    this.realtime.emitToAll('story:deleted', { storyId, authorId: userId });
  }

  /**
   * The link is made when a story is opened, not with the feed: the feed stays free of
   * signatures, and a tab open for days has no link to go stale.
   */
  async playback(storyId: string): Promise<StoryPlaybackDto> {
    const story = await this.findActive(storyId);
    const token = await this.tokens.signMedia(storyId, story.expiresAt);
    return { videoUrl: `/api/stories/${storyId}/video?token=${encodeURIComponent(token)}` };
  }

  /** A story for playback: the signed media token stands in for the Authorization header. */
  async findPlayable(storyId: string, token: string): Promise<Story> {
    await this.tokens.verifyMedia(token, storyId);
    return this.findActive(storyId);
  }

  private async findActive(storyId: string): Promise<Story> {
    if (!Types.ObjectId.isValid(storyId)) {
      throw new NotFoundException('Story not found');
    }
    // Expired stories may still be on disk until the TTL monitor runs; they are never served.
    const story = await this.stories
      .findOne({ _id: new Types.ObjectId(storyId), expiresAt: { $gt: new Date() } })
      .lean()
      .exec();
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    return story;
  }

  private toDto(story: Story, viewed: boolean): StoryDto {
    return {
      id: story._id.toString(),
      authorId: story.authorId.toString(),
      mimeType: story.mimeType,
      durationMs: story.durationMs,
      sizeBytes: story.sizeBytes,
      createdAt: story.createdAt.toISOString(),
      expiresAt: story.expiresAt.toISOString(),
      viewed,
    };
  }
}
