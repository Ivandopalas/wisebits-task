import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageModule } from '../storage/storage.module.js';
import { UsersModule } from '../users/users.module.js';
import { StoriesCleanupJob } from './stories-cleanup.job.js';
import { StoriesController } from './stories.controller.js';
import { StoriesService } from './stories.service.js';
import { Story, StorySchema, StoryView, StoryViewSchema } from './story.schema.js';

@Module({
  imports: [
    UsersModule,
    StorageModule,
    MongooseModule.forFeature([
      { name: Story.name, schema: StorySchema },
      { name: StoryView.name, schema: StoryViewSchema },
    ]),
  ],
  controllers: [StoriesController],
  providers: [StoriesService, StoriesCleanupJob],
})
export class StoriesModule {}
