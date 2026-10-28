import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module.js';
import { ChatModule } from './chat/chat.module.js';
import { LoggingModule } from './common/logging.module.js';
import { AppConfigModule } from './config/config.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { StoriesModule } from './stories/stories.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    ScheduleModule.forRoot(),
    DatabaseModule,
    RealtimeModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ConversationsModule,
    MessagesModule,
    ChatModule,
    StoriesModule,
  ],
})
export class AppModule {}
