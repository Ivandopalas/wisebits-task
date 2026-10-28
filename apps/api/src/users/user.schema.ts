import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'users', timestamps: { createdAt: true, updatedAt: false } })
export class User {
  _id: Types.ObjectId;

  /** Stored lowercased; the unique index makes the address case-insensitive. */
  @Prop({ required: true, unique: true })
  email: string;

  /** Display form, as the user typed it. */
  @Prop({ required: true })
  username: string;

  /** Uniqueness and prefix search are case-insensitive, both served by this index. */
  @Prop({ required: true, unique: true })
  usernameLower: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  createdAt: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
