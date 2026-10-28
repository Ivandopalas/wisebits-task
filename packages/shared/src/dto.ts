import type { StoryMimeType } from './limits.js';

/** Dates travel as ISO strings. */
export type IsoDate = string;

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface UserDto {
  id: string;
  username: string;
  createdAt: IsoDate;
}

export interface MeDto extends UserDto {
  email: string;
}

export interface AuthResponse {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  user: MeDto;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  seq: number;
  senderId: string;
  text: string;
  clientMessageId: string;
  createdAt: IsoDate;
}

export interface MessagesPage {
  /** Always ascending by seq. */
  items: MessageDto[];
  hasMore: boolean;
}

export interface LastMessageDto {
  id: string;
  seq: number;
  senderId: string;
  text: string;
  createdAt: IsoDate;
}

/** A conversation as seen by one of its two participants. */
export interface ConversationDto {
  id: string;
  peer: UserDto;
  lastMessage: LastMessageDto | null;
  unreadCount: number;
  /** Highest seq the peer has read; drives the "read" ticks on my messages. */
  peerLastReadSeq: number;
  lastActivityAt: IsoDate;
  createdAt: IsoDate;
}

export interface StoryDto {
  id: string;
  authorId: string;
  mimeType: StoryMimeType;
  durationMs: number;
  sizeBytes: number;
  createdAt: IsoDate;
  expiresAt: IsoDate;
  /** Short-lived signed URL: a <video> element cannot send an Authorization header. */
  videoUrl: string;
  viewed: boolean;
}

export interface StoryFeedItem {
  author: UserDto;
  /** Ascending by creation time, the order they are played in. */
  stories: StoryDto[];
  hasUnseen: boolean;
  latestAt: IsoDate;
}
