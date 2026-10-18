import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true })
export class User {
  @Prop({
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 64,
  })
  username: string;

  // argon2id encoded hash (includes salt + params)
  @Prop({ required: true, select: false })
  passwordHash: string;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
