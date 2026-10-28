import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module.js';
import { Conversation, ConversationSchema } from './conversation.schema.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([{ name: Conversation.name, schema: ConversationSchema }]),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService, MongooseModule],
})
export class ConversationsModule {}
