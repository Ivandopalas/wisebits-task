import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose, { Types, type Connection } from 'mongoose';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { VideoStorage, type ByteRange, type NewVideo, type StoredVideo } from './video-storage.js';

const BUCKET = 'videos';

@Injectable()
export class GridFsVideoStorage extends VideoStorage implements OnModuleInit {
  private readonly bucket: mongoose.mongo.GridFSBucket;

  constructor(@InjectConnection() private readonly connection: Connection) {
    super();
    this.bucket = new mongoose.mongo.GridFSBucket(connection.db!, { bucketName: BUCKET });
  }

  /** The cleanup job looks files up by expiry; without this index it would scan the bucket. */
  async onModuleInit() {
    await this.connection
      .db!.collection(`${BUCKET}.files`)
      .createIndex({ 'metadata.expiresAt': 1 });
  }

  async save(video: NewVideo): Promise<StoredVideo> {
    const upload = this.bucket.openUploadStream(`story-${Date.now()}`, {
      metadata: {
        contentType: video.contentType,
        ownerId: video.ownerId,
        expiresAt: video.expiresAt,
      },
    });
    await pipeline(Readable.from([video.data]), upload);
    return { id: upload.id.toString(), length: video.data.length };
  }

  async stat(id: string): Promise<StoredVideo | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const [file] = await this.bucket
      .find({ _id: new Types.ObjectId(id) })
      .limit(1)
      .toArray();
    return file ? { id, length: file.length } : null;
  }

  open(id: string, range?: ByteRange): Readable {
    return this.bucket.openDownloadStream(
      new Types.ObjectId(id),
      range ? { start: range.start, end: range.end + 1 } : undefined,
    );
  }

  async delete(id: string): Promise<void> {
    try {
      await this.bucket.delete(new Types.ObjectId(id));
    } catch (error) {
      // Another instance (or an earlier run) already removed it.
      if (!(error instanceof Error && /file not found/i.test(error.message))) {
        throw error;
      }
    }
  }

  async deleteExpired(now: Date): Promise<number> {
    const expired = await this.bucket
      .find({ 'metadata.expiresAt': { $lte: now } }, { projection: { _id: 1 } })
      .toArray();
    for (const file of expired) {
      await this.delete(file._id.toString());
    }
    return expired.length;
  }
}
