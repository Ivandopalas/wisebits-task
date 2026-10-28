import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class LastMessage {
  @Prop({ type: Types.ObjectId, required: true })
  id: Types.ObjectId;

  @Prop({ required: true })
  seq: number;

  @Prop({ type: Types.ObjectId, required: true })
  senderId: Types.ObjectId;

  @Prop({ required: true })
  text: string;

  @Prop({ required: true })
  createdAt: Date;
}

const LastMessageSchema = SchemaFactory.createForClass(LastMessage);

@Schema({ collection: 'conversations', timestamps: { createdAt: true, updatedAt: false } })
export class Conversation {
  _id: Types.ObjectId;

  /** Exactly two user ids, sorted. */
  @Prop({ type: [Types.ObjectId], required: true })
  participants: Types.ObjectId[];

  /** "<smaller id>:<larger id>": the unique index makes one conversation per pair. */
  @Prop({ required: true, unique: true })
  pairKey: string;

  @Prop({ type: Types.ObjectId, required: true })
  createdBy: Types.ObjectId;

  /** Sequence number of the latest message; incremented inside the send transaction. */
  @Prop({ required: true, default: 0 })
  seq: number;

  @Prop({ type: LastMessageSchema, default: null })
  lastMessage: LastMessage | null;

  /** Sort key of the conversation list: creation time until the first message arrives. */
  @Prop({ required: true })
  lastActivityAt: Date;

  /** Unread message count per participant id (a plain object in lean reads). */
  @Prop({ type: Map, of: Number, default: {} })
  unread: Record<string, number>;

  /** Highest seq each participant has read. */
  @Prop({ type: Map, of: Number, default: {} })
  lastReadSeq: Record<string, number>;

  createdAt: Date;
}

export type ConversationDocument = HydratedDocument<Conversation>;
export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ participants: 1, lastActivityAt: -1, _id: -1 });

export function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join(':');
}
