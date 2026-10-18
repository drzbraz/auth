import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { TokenPair } from './auth.types';
import { TokensService } from './tokens.service';
import { RefreshSession } from './schemas/refresh-session.schema';

const INVALID_REFRESH_TOKEN = 'Invalid or expired refresh token';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
    @InjectModel(RefreshSession.name)
    private readonly sessionModel: Model<RefreshSession>,
  ) {}

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.usersService.verifyCredentials(
      dto.username,
      dto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.tokensService.issueTokenPair(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const now = new Date();
    const tokenHash = this.tokensService.hashToken(refreshToken);

    // Atomic consume: of two concurrent requests with the same token, only one
    // can match an unused session.
    const consumed = await this.sessionModel
      .findOneAndUpdate(
        { tokenHash, usedAt: null, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { usedAt: now } },
      )
      .exec();

    if (!consumed) {
      const existing = await this.sessionModel.findOne({ tokenHash }).exec();
      if (existing?.usedAt) {
        // An already-rotated token was presented again: assume it was stolen.
        await this.revokeAllSessions(existing.userId);
      }
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    const user = await this.usersService.findById(consumed.userId);
    if (!user) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    const { token, sessionId } = await this.tokensService.createRefreshSession(
      user._id,
    );

    // Reuse handling may have run between the consume and the insert above; its
    // bulk revoke also marks the consumed session, so re-check it here or the
    // new session would escape revocation.
    const old = await this.sessionModel
      .findOneAndUpdate(
        { _id: consumed._id },
        { $set: { replacedBy: sessionId } },
        { new: true },
      )
      .exec();
    if (old?.revokedAt) {
      await this.sessionModel
        .updateOne({ _id: sessionId }, { $set: { revokedAt: new Date() } })
        .exec();
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    const accessToken = await this.tokensService.signAccessToken({
      id: user._id.toString(),
      username: user.username,
    });
    return { accessToken, refreshToken: token };
  }

  async logout(accessToken: string): Promise<void> {
    const { sub } = await this.tokensService.verifyAccessToken(accessToken);
    await this.revokeAllSessions(new Types.ObjectId(sub));
  }

  private async revokeAllSessions(userId: Types.ObjectId): Promise<void> {
    await this.sessionModel
      .updateMany(
        { userId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
  }
}
