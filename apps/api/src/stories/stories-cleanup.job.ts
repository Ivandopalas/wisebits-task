import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VideoStorage } from '../storage/video-storage.js';

/**
 * Removes video files of expired stories. Runs on every API replica: deleting by expiry is
 * idempotent, so two instances racing for the same file is harmless and no leader election
 * is needed.
 */
@Injectable()
export class StoriesCleanupJob {
  private readonly logger = new Logger(StoriesCleanupJob.name);
  private running = false;

  constructor(private readonly storage: VideoStorage) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(now = new Date()): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      const removed = await this.storage.deleteExpired(now);
      if (removed > 0) {
        this.logger.log({ removed }, 'Removed expired story videos');
      }
      return removed;
    } catch (error) {
      this.logger.error({ err: error }, 'Story cleanup failed');
      return 0;
    } finally {
      this.running = false;
    }
  }
}
