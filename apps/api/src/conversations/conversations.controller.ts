import { Body, Controller, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  apiErrorSchema,
  conversationDtoSchema,
  createConversationSchema,
  listConversationsQuerySchema,
  objectIdSchema,
  pageSchema,
  type CreateConversationInput,
  type ListConversationsQuery,
} from '@chat/shared';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ConversationsService } from './conversations.service.js';

@ApiTags('conversations')
@ApiBearerAuth()
@ApiDefaultResponse({ description: 'Error', standardSchema: apiErrorSchema })
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @ApiOkResponse({ standardSchema: pageSchema(conversationDtoSchema) })
  @Get()
  list(
    @Query({ schema: listConversationsQuerySchema }) query: ListConversationsQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.conversations.list(user.id, query);
  }

  /** Opens the conversation with a user: 201 when it was created, 200 when it already existed. */
  @ApiCreatedResponse({ description: 'Created', standardSchema: conversationDtoSchema })
  @ApiOkResponse({ description: 'Already existed', standardSchema: conversationDtoSchema })
  @Post()
  async open(
    @Body({ schema: createConversationSchema }) body: CreateConversationInput,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { conversation, created } = await this.conversations.open(user.id, body.userId);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return conversation;
  }

  @ApiOkResponse({ standardSchema: conversationDtoSchema })
  @Get(':id')
  get(@Param('id', { schema: objectIdSchema }) id: string, @CurrentUser() user: AuthUser) {
    return this.conversations.getForUser(id, user.id);
  }
}
