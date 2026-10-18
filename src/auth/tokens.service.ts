import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { RefreshSession } from './schemas/refresh-session.schema';
import { AccessTokenPayload, TokenPair } from './auth.types';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(RefreshSession.name)
    private readonly sessionModel: Model<RefreshSession>,
  ) {}

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  generateRefreshToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  signAccessToken(user: { id: string; username: string }): Promise<string> {
    return this.jwtService.signAsync({ sub: user.id, username: user.username });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const { sub, username } =
        await this.jwtService.verifyAsync<AccessTokenPayload>(token);
      return { sub, username };
    } catch {
      // Never echo the token or the verification error back to the caller
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  async createRefreshSession(
    userId: Types.ObjectId,
  ): Promise<{ token: string; sessionId: Types.ObjectId }> {
    const token = this.generateRefreshToken();
    const ttlDays = this.configService.get<number>('REFRESH_TOKEN_TTL_DAYS', 7);
    const session = await this.sessionModel.create({
      userId,
      tokenHash: this.hashToken(token),
      expiresAt: new Date(Date.now() + ttlDays * DAY_MS),
    });
    return { token, sessionId: session._id };
  }

  async issueTokenPair(user: {
    _id: Types.ObjectId;
    username: string;
  }): Promise<TokenPair> {
    const { token: refreshToken } = await this.createRefreshSession(user._id);
    const accessToken = await this.signAccessToken({
      id: user._id.toString(),
      username: user.username,
    });
    return { accessToken, refreshToken };
  }
}
