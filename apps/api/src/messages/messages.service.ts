import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ListMessagesQuery, MessageDto, MessagesPage } from '@chat/shared';
import { Model, Types, type Connection } from 'mongoose';
import { isDuplicateKeyError } from '../common/errors/to-api-error.js';
import { Conversation } from '../conversations/conversation.schema.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { toMessageDto } from './message.mapper.js';
import { Message } from './message.schema.js';

export interface SendInput {
  text: string;
  clientMessageId: string;
}

export interface SendResult {
  message: MessageDto;
  /** False when the same clientMessageId was already stored: a retry, nothing new was written. */
  created: boolean;
}

@Injectable()
export class MessagesService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Message.name) private readonly messages: Model<Message>,
    @InjectModel(Conversation.name) private readonly conversationModel: Model<Conversation>,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Stores the message and updates the conversation (sequence, preview, unread counters) in one
   * transaction, then notifies both participants. Concurrent sends to one conversation collide on
   * the `seq` increment; the transaction helper retries the loser, so seq stays gapless.
   */
  async send(conversationId: string, senderId: string, input: SendInput): Promise<SendResult> {
    const conversation = await this.conversations.requireParticipant(conversationId, senderId);
    const previous = await this.findByClientId(senderId, input.clientMessageId);
    if (previous) {
      return this.replay(previous, conversationId);
    }

    const recipientId = conversation.participants.map(String).find((id) => id !== senderId)!;
    let message: Message;
    try {
      message = await this.connection.transaction(async (session) => {
        const { seq } = (await this.conversationModel
          .findOneAndUpdate(
            { _id: conversation._id },
            { $inc: { seq: 1 } },
            { returnDocument: 'after', session },
          )
          .select({ seq: 1 })
          .lean()
          .exec())!;

        const [created] = await this.messages.create(
          [
            {
              conversationId: conversation._id,
              seq,
              senderId: new Types.ObjectId(senderId),
              text: input.text,
              clientMessageId: input.clientMessageId,
            },
          ],
          { session },
        );

        await this.conversationModel.updateOne(
          { _id: conversation._id },
          {
            $set: {
              lastMessage: {
                id: created!._id,
                seq,
                senderId: created!.senderId,
                text: created!.text,
                createdAt: created!.createdAt,
              },
              lastActivityAt: created!.createdAt,
              // Replying means the sender has seen everything before it.
              [`unread.${senderId}`]: 0,
            },
            $max: { [`lastReadSeq.${senderId}`]: seq },
            $inc: { [`unread.${recipientId}`]: 1 },
          },
          { session },
        );
        return created!.toObject();
      });
    } catch (error) {
      // The same client id raced in from another connection and won.
      if (isDuplicateKeyError(error) && error.keyPattern?.clientMessageId) {
        const stored = await this.findByClientId(senderId, input.clientMessageId);
        if (stored) {
          return this.replay(stored, conversationId);
        }
      }
      throw error;
    }

    await this.broadcastNewMessage(message);
    return { message: toMessageDto(message), created: true };
  }

  async history(
    conversationId: string,
    userId: string,
    query: ListMessagesQuery,
  ): Promise<MessagesPage> {
    await this.conversations.requireParticipant(conversationId, userId);
    const id = new Types.ObjectId(conversationId);

    if (query.after !== undefined) {
      const docs = await this.messages
        .find({ conversationId: id, seq: { $gt: query.after } })
        .sort({ seq: 1 })
        .limit(query.limit + 1)
        .lean()
        .exec();
      return {
        items: docs.slice(0, query.limit).map(toMessageDto),
        hasMore: docs.length > query.limit,
      };
    }

    const docs = await this.messages
      .find({
        conversationId: id,
        ...(query.before !== undefined && { seq: { $lt: query.before } }),
      })
      .sort({ seq: -1 })
      .limit(query.limit + 1)
      .lean()
      .exec();
    return {
      items: docs.slice(0, query.limit).reverse().map(toMessageDto),
      hasMore: docs.length > query.limit,
    };
  }

  /** Moves the user's read marker forward (never back) and recomputes their unread count. */
  async markRead(conversationId: string, userId: string, seq: number): Promise<{ seq: number }> {
    const conversation = await this.conversations.requireParticipant(conversationId, userId);
    const peerId = conversation.participants.map(String).find((id) => id !== userId)!;

    const result = await this.connection.transaction(async (session) => {
      const current = (await this.conversationModel
        .findById(conversation._id, { seq: 1, lastReadSeq: 1 }, { session })
        .lean()
        .exec())!;
      const target = Math.min(seq, current.seq);
      const readSoFar = current.lastReadSeq?.[userId] ?? 0;
      if (target <= readSoFar) {
        return { seq: readSoFar, changed: false };
      }
      const unread =
        target === current.seq
          ? 0
          : await this.messages.countDocuments(
              {
                conversationId: conversation._id,
                senderId: new Types.ObjectId(peerId),
                seq: { $gt: target },
              },
              { session },
            );
      await this.conversationModel.updateOne(
        { _id: conversation._id },
        { $set: { [`lastReadSeq.${userId}`]: target, [`unread.${userId}`]: unread } },
        { session },
      );
      return { seq: target, changed: true };
    });

    if (result.changed) {
      this.realtime.emitToUsers([userId, peerId], 'conversation:read', {
        conversationId,
        userId,
        seq: result.seq,
      });
    }
    return { seq: result.seq };
  }

  private findByClientId(senderId: string, clientMessageId: string) {
    return this.messages
      .findOne({ senderId: new Types.ObjectId(senderId), clientMessageId })
      .lean()
      .exec();
  }

  /**
   * The first attempt may have committed and then lost its broadcast along with its ack, when
   * its instance stopped in between. The retry is the only trace of that, so it delivers again;
   * clients drop what they already have by clientMessageId.
   */
  private async replay(message: Message, conversationId: string): Promise<SendResult> {
    if (!message.conversationId.equals(conversationId)) {
      throw new ConflictException('This clientMessageId was already used in another conversation');
    }
    await this.broadcastNewMessage(message);
    return { message: toMessageDto(message), created: false };
  }

  /** Each participant gets the conversation as they see it (their peer, their unread count). */
  private async broadcastNewMessage(message: Message): Promise<void> {
    const conversation = await this.conversationModel
      .findById(message.conversationId)
      .lean()
      .exec();
    if (!conversation) {
      return;
    }
    const users = await this.conversations.loadUsers(conversation.participants);
    const dto = toMessageDto(message);
    for (const participant of conversation.participants.map(String)) {
      this.realtime.emitToUsers([participant], 'message:new', {
        message: dto,
        conversation: this.conversations.toDto(conversation, participant, users),
      });
    }
  }
}
