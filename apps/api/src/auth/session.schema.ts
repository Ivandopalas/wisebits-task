import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * One refresh token. Every refresh rotates the token: the old row is marked `rotatedAt`
 * and a new row joins the same family. Presenting a rotated token later means it leaked,
 * and the whole family is revoked.
 */
@Schema({ collection: 'sessions', timestamps: { createdAt: true, updatedAt: false } })
export class Session {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  familyId: string;

  /** SHA-256 of the token; the token itself is never stored. */
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Date, required: true, expires: 0 })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  rotatedAt: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  createdAt: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
