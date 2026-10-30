import type { ApiError, ConversationDto, MessageDto } from './dto.js';
import type {
  WsMarkReadPayload,
  WsPresenceQueryPayload,
  WsSendMessagePayload,
  WsTypingPayload,
} from './schemas.js';

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };
export type Ack<T> = (response: AckResponse<T>) => void;

/** Sent in `connect_error.data.code` when the handshake is rejected. */
export const SOCKET_ERROR = {
  tokenExpired: 'TOKEN_EXPIRED',
  unauthorized: 'UNAUTHORIZED',
  /** The check itself failed, nothing is wrong with the token: try again in a moment. */
  unavailable: 'UNAVAILABLE',
} as const;
export type SocketErrorCode = (typeof SOCKET_ERROR)[keyof typeof SOCKET_ERROR];

export interface MessageNewEvent {
  message: MessageDto;
  /** The conversation from the receiving user's point of view. */
  conversation: ConversationDto;
}

export interface ConversationReadEvent {
  conversationId: string;
  userId: string;
  seq: number;
}

export interface TypingEvent {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface PresenceEvent {
  userId: string;
  online: boolean;
}

export interface StoryCreatedEvent {
  storyId: string;
  authorId: string;
}

export interface StoryDeletedEvent {
  storyId: string;
  authorId: string;
}

export interface ServerToClientEvents {
  'message:new': (event: MessageNewEvent) => void;
  'conversation:read': (event: ConversationReadEvent) => void;
  typing: (event: TypingEvent) => void;
  presence: (event: PresenceEvent) => void;
  'story:created': (event: StoryCreatedEvent) => void;
  'story:deleted': (event: StoryDeletedEvent) => void;
}

export interface ClientToServerEvents {
  'message:send': (payload: WsSendMessagePayload, ack: Ack<MessageDto>) => void;
  'conversation:read': (payload: WsMarkReadPayload, ack: Ack<{ seq: number }>) => void;
  typing: (payload: WsTypingPayload) => void;
  'presence:query': (payload: WsPresenceQueryPayload, ack: Ack<Record<string, boolean>>) => void;
}
