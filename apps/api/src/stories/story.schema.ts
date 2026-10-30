import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { STORY_MIME_TYPES, type StoryMimeType } from '@chat/shared';
import { Types } from 'mongoose';

@Schema({ collection: 'stories', timestamps: { createdAt: true, updatedAt: false } })
export class Story {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true })
  videoId: string;

  @Prop({ type: String, required: true, enum: STORY_MIME_TYPES })
  mimeType: StoryMimeType;

  @Prop({ required: true })
  durationMs: number;

  @Prop({ required: true })
  sizeBytes: number;

  /**
   * The TTL index removes the document after expiry, but only roughly once a minute and never
   * the GridFS file: queries filter on expiresAt themselves and a job removes the files.
   */
  @Prop({ type: Date, required: true, expires: 0 })
  expiresAt: Date;

  createdAt: Date;
}

export const StorySchema = SchemaFactory.createForClass(Story);

@Schema({ collection: 'story_views', timestamps: { createdAt: true, updatedAt: false } })
export class StoryView {
  @Prop({ type: Types.ObjectId, required: true })
  storyId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  viewerId: Types.ObjectId;

  /** Copied from the story so views disappear together with it. */
  @Prop({ type: Date, required: true, expires: 0 })
  expiresAt: Date;
}

export const StoryViewSchema = SchemaFactory.createForClass(StoryView);
StoryViewSchema.index({ storyId: 1, viewerId: 1 }, { unique: true });
StoryViewSchema.index({ viewerId: 1 });
