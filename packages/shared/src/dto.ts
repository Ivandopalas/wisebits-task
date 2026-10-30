import { z } from 'zod';
import { STORY_MIME_TYPES } from './limits.js';

// Response shapes. The types are what both sides compile against; the schemas document the
// API in OpenAPI and are not used to parse responses.

const isoDate = z.iso.datetime();

export const apiErrorSchema = z
  .object({
    statusCode: z.number().int(),
    error: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  })
  .meta({ id: 'ApiError' });
export type ApiError = z.infer<typeof apiErrorSchema>;

export const userDtoSchema = z
  .object({ id: z.string(), username: z.string(), createdAt: isoDate })
  .meta({ id: 'User' });
export type UserDto = z.infer<typeof userDtoSchema>;

export const meDtoSchema = userDtoSchema.extend({ email: z.string() }).meta({ id: 'Me' });
export type MeDto = z.infer<typeof meDtoSchema>;

export const authResponseSchema = z
  .object({
    accessToken: z.string(),
    expiresIn: z.number().int().meta({ description: 'Access token lifetime in seconds' }),
    user: meDtoSchema,
  })
  .meta({ id: 'AuthResponse' });
export type AuthResponse = z.infer<typeof authResponseSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const messageDtoSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    seq: z.number().int(),
    senderId: z.string(),
    text: z.string(),
    clientMessageId: z.string(),
    createdAt: isoDate,
  })
  .meta({ id: 'Message' });
export type MessageDto = z.infer<typeof messageDtoSchema>;

export const messagesPageSchema = z
  .object({
    items: z.array(messageDtoSchema).meta({ description: 'Always ascending by seq' }),
    hasMore: z.boolean(),
  })
  .meta({ id: 'MessagesPage' });
export type MessagesPage = z.infer<typeof messagesPageSchema>;

const lastMessageDtoSchema = messageDtoSchema
  .pick({ id: true, seq: true, senderId: true, text: true, createdAt: true })
  .meta({ id: 'LastMessage' });

export const conversationDtoSchema = z
  .object({
    id: z.string(),
    peer: userDtoSchema,
    lastMessage: lastMessageDtoSchema.nullable(),
    unreadCount: z.number().int(),
    peerLastReadSeq: z
      .number()
      .int()
      .meta({ description: 'Highest seq the peer has read: the "read" ticks on my messages' }),
    lastActivityAt: isoDate,
    createdAt: isoDate,
  })
  .meta({ id: 'Conversation', description: 'As seen by one of its two participants' });
export type ConversationDto = z.infer<typeof conversationDtoSchema>;

export const storyDtoSchema = z
  .object({
    id: z.string(),
    authorId: z.string(),
    mimeType: z.enum(STORY_MIME_TYPES),
    durationMs: z.number().int(),
    sizeBytes: z.number().int(),
    createdAt: isoDate,
    expiresAt: isoDate,
    videoUrl: z.string().meta({
      description: 'Short-lived signed URL: a <video> element cannot send an Authorization header',
    }),
    viewed: z.boolean(),
  })
  .meta({ id: 'Story' });
export type StoryDto = z.infer<typeof storyDtoSchema>;

export const storyFeedItemSchema = z
  .object({
    author: userDtoSchema,
    stories: z.array(storyDtoSchema).meta({ description: 'In the order they are played' }),
    hasUnseen: z.boolean(),
    latestAt: isoDate,
  })
  .meta({ id: 'StoryFeedItem' });
export type StoryFeedItem = z.infer<typeof storyFeedItemSchema>;
