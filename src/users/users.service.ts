import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as argon2 from 'argon2';
import { User, UserDocument } from './schemas/user.schema';

// Verified against when the username is unknown, so response time does not
// reveal whether an account exists.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () =>
  (dummyHash ??= argon2.hash('dummy-password', { type: argon2.argon2id }));

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedInitialUser();
  }

  private hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async create(username: string, password: string): Promise<UserDocument> {
    return this.userModel.create({
      username,
      passwordHash: await this.hashPassword(password),
    });
  }

  findById(id: Types.ObjectId): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  findByUsername(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username }).select('+passwordHash').exec();
  }

  async verifyCredentials(
    username: string,
    password: string,
  ): Promise<UserDocument | null> {
    const user = await this.findByUsername(username);
    const hash = user?.passwordHash ?? (await getDummyHash());
    const valid = await argon2.verify(hash, password);
    return user && valid ? user : null;
  }

  async seedInitialUser(): Promise<void> {
    const username = this.configService.get<string>('INITIAL_USER_USERNAME');
    const password = this.configService.get<string>('INITIAL_USER_PASSWORD');
    if (!username || !password) {
      return;
    }
    await this.userModel
      .updateOne(
        { username },
        {
          $setOnInsert: {
            username,
            passwordHash: await this.hashPassword(password),
          },
        },
        { upsert: true },
      )
      .exec();
  }
}
