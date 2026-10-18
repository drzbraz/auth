import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class RefreshSession {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId: Types.ObjectId;

  // SHA-256 hex of the opaque token; the raw token is never stored
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Date, required: true, index: { expireAfterSeconds: 0 } })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  usedAt: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  replacedBy: Types.ObjectId | null;
}

export type RefreshSessionDocument = HydratedDocument<RefreshSession>;
export const RefreshSessionSchema =
  SchemaFactory.createForClass(RefreshSession);
