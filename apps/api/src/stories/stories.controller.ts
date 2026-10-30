import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiPartialContentResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  apiErrorSchema,
  createStorySchema,
  LIMITS,
  objectIdSchema,
  STORY_MIME_TYPES,
  storyDtoSchema,
  storyFeedItemSchema,
  storyVideoQuerySchema,
  type CreateStoryInput,
  type StoryVideoQuery,
} from '@chat/shared';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { VideoStorage } from '../storage/video-storage.js';
import { parseRange, UNSATISFIABLE } from './range.js';
import { StoriesService } from './stories.service.js';

const VIDEO_CONTENT = Object.fromEntries(
  STORY_MIME_TYPES.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
);

@ApiTags('stories')
@ApiDefaultResponse({ description: 'Error', standardSchema: apiErrorSchema })
@Controller('stories')
export class StoriesController {
  constructor(
    private readonly stories: StoriesService,
    private readonly storage: VideoStorage,
  ) {}

  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['video', 'durationMs'],
      properties: {
        video: { type: 'string', format: 'binary', description: 'WebM or MP4, up to 25 MB' },
        durationMs: { type: 'integer', minimum: 1, maximum: 15_500 },
      },
    },
  })
  @ApiCreatedResponse({ standardSchema: storyDtoSchema })
  @Post()
  @UseInterceptors(
    // Multer's default memory storage: the signature is checked before anything is stored,
    // and the size cap bounds the buffer.
    FileInterceptor('video', { limits: { fileSize: LIMITS.storyMaxBytes, files: 1, fields: 4 } }),
  )
  create(
    @UploadedFile() video: Express.Multer.File | undefined,
    @Body({ schema: createStorySchema }) body: CreateStoryInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stories.create(user.id, video?.buffer, body.durationMs);
  }

  @ApiBearerAuth()
  @ApiOkResponse({ standardSchema: z.array(storyFeedItemSchema) })
  @Get('feed')
  feed(@CurrentUser() user: AuthUser) {
    return this.stories.feed(user.id);
  }

  @ApiBearerAuth()
  @ApiNoContentResponse()
  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  view(@Param('id', { schema: objectIdSchema }) id: string, @CurrentUser() user: AuthUser) {
    return this.stories.markViewed(id, user.id);
  }

  @ApiBearerAuth()
  @ApiNoContentResponse()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', { schema: objectIdSchema }) id: string, @CurrentUser() user: AuthUser) {
    return this.stories.remove(id, user.id);
  }

  /**
   * Streams the video with HTTP Range support: browsers (Safari above all) need 206 responses to
   * play and seek. Authorized by the signed token from the feed, since <video> sends no headers.
   */
  @Public()
  @ApiOkResponse({ description: 'The whole file', content: VIDEO_CONTENT })
  @ApiPartialContentResponse({ description: 'The requested byte range', content: VIDEO_CONTENT })
  @Get(':id/video')
  async video(
    @Param('id', { schema: objectIdSchema }) id: string,
    @Query({ schema: storyVideoQuerySchema }) query: StoryVideoQuery,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ) {
    const story = await this.stories.findPlayable(id, query.token);
    const file = await this.storage.stat(story.videoId);
    if (!file) {
      throw new NotFoundException('Video not found');
    }

    const range = parseRange(rangeHeader, file.length);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', story.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (range === UNSATISFIABLE) {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      res.setHeader('Content-Range', `bytes */${file.length}`);
      res.end();
      return;
    }
    if (range) {
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.length}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
    } else {
      res.status(HttpStatus.OK);
      res.setHeader('Content-Length', file.length);
    }
    // A viewer skipping ahead aborts the request; that is not an error worth logging.
    await pipeline(this.storage.open(story.videoId, range ?? undefined), res).catch(
      () => undefined,
    );
  }
}
