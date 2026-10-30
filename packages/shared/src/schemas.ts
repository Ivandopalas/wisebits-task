import { z } from 'zod';
import { LIMITS, STORY_DURATION_TOLERANCE_MS } from './limits.js';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email').max(LIMITS.emailMax));

export const usernameSchema = z
  .string()
  .trim()
  .min(LIMITS.usernameMin, `Username must be at least ${LIMITS.usernameMin} characters`)
  .max(LIMITS.usernameMax, `Username must be at most ${LIMITS.usernameMax} characters`)
  .regex(/^[a-zA-Z0-9_.]+$/, 'Use only letters, digits, "_" and "."');

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `Password must be at least ${LIMITS.passwordMin} characters`)
  .max(LIMITS.passwordMax, `Password must be at most ${LIMITS.passwordMax} characters`);

export const registerSchema = z.strictObject({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(LIMITS.passwordMax),
});
export type LoginInput = z.input<typeof loginSchema>;

const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(LIMITS.pageSizeMax)
  .default(LIMITS.pageSizeDefault);

export const listUsersQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(LIMITS.usernameMax)
    .regex(/^\P{Cc}*$/u, 'Search cannot contain control characters')
    .optional(),
  cursor: z.string().max(LIMITS.usernameMax).optional(),
  limit: limitSchema,
});
export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;

export const listConversationsQuerySchema = z.strictObject({
  cursor: z.string().max(64).optional(),
  limit: limitSchema,
});
export type ListConversationsQuery = z.output<typeof listConversationsQuerySchema>;

export const createConversationSchema = z.strictObject({
  userId: objectIdSchema,
});
export type CreateConversationInput = z.input<typeof createConversationSchema>;

const seqSchema = z.coerce.number().int().min(0);

export const listMessagesQuerySchema = z
  .strictObject({
    before: seqSchema.optional(),
    after: seqSchema.optional(),
    limit: limitSchema,
  })
  .refine((q) => q.before === undefined || q.after === undefined, {
    message: 'Use either "before" or "after", not both',
  });
export type ListMessagesQuery = z.output<typeof listMessagesQuerySchema>;

export const messageTextSchema = z
  .string()
  .trim()
  .min(1, 'Message cannot be empty')
  .max(LIMITS.messageMaxLength, `Message must be at most ${LIMITS.messageMaxLength} characters`)
  .regex(/^(?:\P{Cc}|[\t\n\r])*$/u, 'Message cannot contain control characters');

export const sendMessageSchema = z.strictObject({
  text: messageTextSchema,
  clientMessageId: z.uuid(),
});
export type SendMessageInput = z.input<typeof sendMessageSchema>;

export const markReadSchema = z.strictObject({
  seq: z.number().int().min(1),
});
export type MarkReadInput = z.input<typeof markReadSchema>;

export const wsSendMessageSchema = sendMessageSchema.extend({ conversationId: objectIdSchema });
export type WsSendMessagePayload = z.input<typeof wsSendMessageSchema>;

export const wsMarkReadSchema = markReadSchema.extend({ conversationId: objectIdSchema });
export type WsMarkReadPayload = z.input<typeof wsMarkReadSchema>;

export const wsTypingSchema = z.strictObject({
  conversationId: objectIdSchema,
  isTyping: z.boolean(),
});
export type WsTypingPayload = z.input<typeof wsTypingSchema>;

export const wsPresenceQuerySchema = z.strictObject({
  userIds: z.array(objectIdSchema).max(LIMITS.presenceQueryMax),
});
export type WsPresenceQueryPayload = z.input<typeof wsPresenceQuerySchema>;

export const createStorySchema = z.strictObject({
  durationMs: z.coerce
    .number()
    .int()
    .min(1)
    .max(
      LIMITS.storyMaxDurationMs + STORY_DURATION_TOLERANCE_MS,
      `A story can be at most ${LIMITS.storyMaxDurationMs / 1000} seconds long`,
    ),
});
export type CreateStoryInput = z.output<typeof createStorySchema>;

export const storyVideoQuerySchema = z.strictObject({
  token: z.string().min(1).max(1024),
});
export type StoryVideoQuery = z.output<typeof storyVideoQuerySchema>;
