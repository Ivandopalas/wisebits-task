import type { Readable } from 'node:stream';

export interface StoredVideo {
  id: string;
  length: number;
}

export interface NewVideo {
  data: Buffer;
  contentType: string;
  ownerId: string;
  /** The file is garbage once this passes, whether or not its story document still exists. */
  expiresAt: Date;
}

/** Inclusive byte range, as in HTTP. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Where story videos live. GridFS today; S3 or another object store would implement the same
 * contract without touching the stories module.
 */
export abstract class VideoStorage {
  abstract save(video: NewVideo): Promise<StoredVideo>;
  abstract stat(id: string): Promise<StoredVideo | null>;
  abstract open(id: string, range?: ByteRange): Readable;
  /** Idempotent: deleting a missing file is not an error. */
  abstract delete(id: string): Promise<void>;
  /** Removes every file past its expiry; returns how many were removed. */
  abstract deleteExpired(now: Date): Promise<number>;
}
