import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { LoginDto } from './dto/login.dto';
import { TokenPair } from './auth.types';

interface User {
  username: string;
  passwordHash: string;
  salt: string;
}

@Injectable()
export class AuthService {
  private readonly users: Map<string, User> = new Map();
  private readonly accessTokens: Map<string, string> = new Map(); // token -> username
  private readonly refreshTokens: Map<string, string> = new Map(); // token -> username

  constructor() {
    // Seed a demo user: username=admin, ******
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword('secret', salt);
    this.users.set('admin', { username: 'admin', passwordHash, salt });
  }

  private hashPassword(password: string, salt: string): string {
    return crypto
      .scryptSync(password, salt, 64)
      .toString('hex');
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  login(dto: LoginDto): TokenPair {
    const user = this.users.get(dto.username);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const hash = this.hashPassword(dto.password, user.salt);
    if (hash !== user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.generateToken();
    const refreshToken = this.generateToken();

    this.accessTokens.set(accessToken, user.username);
    this.refreshTokens.set(refreshToken, user.username);

    return { accessToken, refreshToken };
  }

  refresh(refreshToken: string): Pick<TokenPair, 'accessToken'> {
    if (!refreshToken) {
      throw new BadRequestException('Refresh token is required');
    }

    const username = this.refreshTokens.get(refreshToken);
    if (!username) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const newAccessToken = this.generateToken();
    this.accessTokens.set(newAccessToken, username);

    return { accessToken: newAccessToken };
  }

  logout(accessToken: string): void {
    if (!accessToken) {
      throw new BadRequestException('Access token is required');
    }

    const username = this.accessTokens.get(accessToken);
    if (!username) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    this.accessTokens.delete(accessToken);

    // Also revoke all refresh tokens for this user
    for (const [token, user] of this.refreshTokens.entries()) {
      if (user === username) {
        this.refreshTokens.delete(token);
      }
    }
  }
}
