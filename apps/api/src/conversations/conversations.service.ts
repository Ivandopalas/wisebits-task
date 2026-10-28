import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ConversationDto, ListConversationsQuery, Page } from '@chat/shared';
import { Model, Types, type QueryFilter } from 'mongoose';
import { isDuplicateKeyError } from '../common/errors/to-api-error.js';
import { toUserDto } from '../users/user.mapper.js';
import type { User } from '../users/user.schema.js';
import { UsersService } from '../users/users.service.js';
import { Conversation, pairKeyOf } from './conversation.schema.js';

type UsersById = Map<string, Pick<User, '_id' | 'username' | 'createdAt'>>;

@Injectable()
export class ConversationsService {
  constructor(
    @InjectModel(Conversation.name) private readonly conversations: Model<Conversation>,
    private readonly users: UsersService,
  ) {}

  /**
   * Returns the one conversation of the pair, creating it if needed. Safe under concurrency:
   * two users clicking "message" at the same moment end up in the same conversation.
   */
  async open(
    userId: string,
    peerId: string,
  ): Promise<{ conversation: ConversationDto; created: boolean }> {
    if (userId === peerId) {
      throw new BadRequestException('You cannot start a conversation with yourself');
    }
    const peer = await this.users.findById(peerId);
    if (!peer) {
      throw new NotFoundException('User not found');
    }

    const pairKey = pairKeyOf(userId, peerId);
    let conversation: Conversation | null = await this.conversations
      .findOne({ pairKey })
      .lean()
      .exec();
    let created = false;
    if (!conversation) {
      try {
        const now = new Date();
        const doc = await this.conversations.create({
          pairKey,
          participants: [userId, peerId].sort().map((id) => new Types.ObjectId(id)),
          createdBy: new Types.ObjectId(userId),
          lastActivityAt: now,
          unread: { [userId]: 0, [peerId]: 0 },
          lastReadSeq: { [userId]: 0, [peerId]: 0 },
        });
        conversation = doc.toObject({ flattenMaps: true }) as Conversation;
        created = true;
      } catch (error) {
        // Both users clicked at once and the other insert won the unique pairKey: use theirs.
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
        conversation = await this.conversations.findOne({ pairKey }).lean().exec();
      }
    }

    const usersById = await this.loadUsers(conversation!.participants);
    return { conversation: this.toDto(conversation!, userId, usersById), created };
  }

  /**
   * Most recently active first. A conversation without messages is shown only to the user who
   * opened it, so nobody gets empty conversations from other people's clicks.
   */
  async list(userId: string, query: ListConversationsQuery): Promise<Page<ConversationDto>> {
    const me = new Types.ObjectId(userId);
    const conditions: QueryFilter<Conversation>[] = [
      { participants: me },
      { $or: [{ seq: { $gt: 0 } }, { createdBy: me }] },
    ];
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (cursor) {
      conditions.push({
        $or: [
          { lastActivityAt: { $lt: cursor.at } },
          { lastActivityAt: cursor.at, _id: { $lt: cursor.id } },
        ],
      });
    }

    const docs = await this.conversations
      .find({ $and: conditions })
      .sort({ lastActivityAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean()
      .exec();

    const hasMore = docs.length > query.limit;
    const page = hasMore ? docs.slice(0, query.limit) : docs;
    const usersById = await this.loadUsers(page.flatMap((c) => c.participants));
    const last = page[page.length - 1];
    return {
      items: page.map((c) => this.toDto(c, userId, usersById)),
      nextCursor: hasMore && last ? encodeCursor(last.lastActivityAt, last._id) : null,
    };
  }

  async getForUser(conversationId: string, userId: string): Promise<ConversationDto> {
    const conversation = await this.requireParticipant(conversationId, userId);
    return this.toDtoWithUsers(conversation, userId);
  }

  async requireParticipant(conversationId: string, userId: string): Promise<Conversation> {
    const conversation = await this.conversations.findById(conversationId).lean().exec();
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (!conversation.participants.some((p) => p.equals(userId))) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }
    return conversation;
  }

  /** Everyone the user has a conversation with: the audience of their presence updates. */
  async partnerIds(userId: string): Promise<string[]> {
    const docs = await this.conversations
      .find({ participants: new Types.ObjectId(userId) }, { participants: 1 })
      .lean()
      .exec();
    return docs.flatMap((c) => c.participants.map(String)).filter((id) => id !== userId);
  }

  async toDtoWithUsers(conversation: Conversation, viewerId: string): Promise<ConversationDto> {
    return this.toDto(conversation, viewerId, await this.loadUsers(conversation.participants));
  }

  toDto(conversation: Conversation, viewerId: string, usersById: UsersById): ConversationDto {
    const peerId = conversation.participants.map(String).find((id) => id !== viewerId)!;
    const peer = usersById.get(peerId);
    const last = conversation.lastMessage;
    return {
      id: conversation._id.toString(),
      peer: peer
        ? toUserDto(peer)
        : { id: peerId, username: 'deleted user', createdAt: conversation.createdAt.toISOString() },
      lastMessage: last
        ? {
            id: last.id.toString(),
            seq: last.seq,
            senderId: last.senderId.toString(),
            text: last.text,
            createdAt: last.createdAt.toISOString(),
          }
        : null,
      unreadCount: conversation.unread?.[viewerId] ?? 0,
      peerLastReadSeq: conversation.lastReadSeq?.[peerId] ?? 0,
      lastActivityAt: conversation.lastActivityAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
    };
  }

  async loadUsers(ids: Types.ObjectId[]): Promise<UsersById> {
    const unique = [...new Set(ids.map(String))];
    const users = await this.users.findByIds(unique);
    return new Map(users.map((u) => [u._id.toString(), u]));
  }
}

function encodeCursor(at: Date, id: Types.ObjectId): string {
  return Buffer.from(`${at.getTime()}:${id.toString()}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: Types.ObjectId } {
  const [time, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  const at = new Date(Number(time));
  if (Number.isNaN(at.getTime()) || !id || !Types.ObjectId.isValid(id)) {
    throw new BadRequestException('Invalid cursor');
  }
  return { at, id: new Types.ObjectId(id) };
}
