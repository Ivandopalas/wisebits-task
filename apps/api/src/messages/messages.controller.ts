import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  apiErrorSchema,
  listMessagesQuerySchema,
  markReadSchema,
  messageDtoSchema,
  messagesPageSchema,
  objectIdSchema,
  sendMessageSchema,
  type ListMessagesQuery,
  type SendMessageInput,
} from '@chat/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { MessagesService } from './messages.service.js';

@ApiTags('messages')
@ApiBearerAuth()
@ApiDefaultResponse({ description: 'Error', standardSchema: apiErrorSchema })
@Controller('conversations/:id')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  /**
   * History, ascending by seq. Without parameters: the latest page. `before=<seq>` pages back
   * through history, `after=<seq>` catches up after a reconnect.
   */
  @ApiOkResponse({ standardSchema: messagesPageSchema })
  @Get('messages')
  history(
    @Param('id', { schema: objectIdSchema }) id: string,
    @Query({ schema: listMessagesQuerySchema }) query: ListMessagesQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.messages.history(id, user.id, query);
  }

  @ApiCreatedResponse({ description: 'Sent', standardSchema: messageDtoSchema })
  @ApiOkResponse({
    description: 'A retry of a message already sent',
    standardSchema: messageDtoSchema,
  })
  @Post('messages')
  async send(
    @Param('id', { schema: objectIdSchema }) id: string,
    @Body({ schema: sendMessageSchema }) body: SendMessageInput,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { message, created } = await this.messages.send(id, user.id, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return message;
  }

  @ApiOkResponse({ standardSchema: z.object({ seq: z.number().int() }) })
  @Post('read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @Param('id', { schema: objectIdSchema }) id: string,
    @Body({ schema: markReadSchema }) body: { seq: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.messages.markRead(id, user.id, body.seq);
  }
}
