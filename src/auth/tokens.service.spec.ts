import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TokensService } from './tokens.service';
import { RefreshSession } from './schemas/refresh-session.schema';

describe('TokensService', () => {
  let service: TokensService;
  let jwtService: JwtService;
  const sessionModel = {
    create: jest.fn<
      Promise<{ _id: Types.ObjectId }>,
      [{ userId: Types.ObjectId; tokenHash: string; expiresAt: Date }]
    >(),
  };

  beforeEach(async () => {
    sessionModel.create.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret-test-secret-test-secret',
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [
        TokensService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(7) },
        },
        { provide: getModelToken(RefreshSession.name), useValue: sessionModel },
      ],
    }).compile();

    service = module.get(TokensService);
    jwtService = module.get(JwtService);
  });

  describe('hashToken', () => {
    it('should be deterministic 64-char hex', () => {
      const a = service.hashToken('abc');
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(service.hashToken('abc')).toBe(a);
      expect(service.hashToken('abd')).not.toBe(a);
    });
  });

  describe('generateRefreshToken', () => {
    it('should return distinct 43-char base64url strings', () => {
      const a = service.generateRefreshToken();
      const b = service.generateRefreshToken();
      expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(a).not.toBe(b);
    });
  });

  describe('signAccessToken', () => {
    it('should sign a JWT with sub, username and a 15 minute lifetime', async () => {
      const token = await service.signAccessToken({
        id: 'user-1',
        username: 'admin',
      });
      const payload = jwtService.decode<{
        sub: string;
        username: string;
        iat: number;
        exp: number;
      }>(token);
      expect(payload.sub).toBe('user-1');
      expect(payload.username).toBe('admin');
      expect(payload.exp - payload.iat).toBe(900);
    });
  });

  describe('createRefreshSession', () => {
    it('should store only the hash and return token and session id', async () => {
      const sessionId = new Types.ObjectId();
      sessionModel.create.mockResolvedValue({ _id: sessionId });
      const userId = new Types.ObjectId();

      const result = await service.createRefreshSession(userId);

      expect(result.sessionId).toBe(sessionId);
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const stored = sessionModel.create.mock.calls[0][0];
      expect(stored.userId).toBe(userId);
      expect(stored.tokenHash).toBe(service.hashToken(result.token));
      expect(JSON.stringify(stored)).not.toContain(result.token);
      const ttlMs = stored.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(7 * 86400_000 - 5000);
      expect(ttlMs).toBeLessThanOrEqual(7 * 86400_000);
    });
  });

  describe('issueTokenPair', () => {
    it('should return an access token and a refresh token', async () => {
      sessionModel.create.mockResolvedValue({ _id: new Types.ObjectId() });
      const pair = await service.issueTokenPair({
        _id: new Types.ObjectId(),
        username: 'admin',
      });
      expect(pair.accessToken.split('.')).toHaveLength(3);
      expect(typeof pair.refreshToken).toBe('string');
    });
  });

  describe('verifyAccessToken', () => {
    const expectRejected = async (token: string) => {
      const error = await service
        .verifyAccessToken(token)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(
        'Invalid or expired access token',
      );
    };

    it('should return sub and username for a valid token', async () => {
      const token = await service.signAccessToken({
        id: 'user-1',
        username: 'admin',
      });
      await expect(service.verifyAccessToken(token)).resolves.toEqual({
        sub: 'user-1',
        username: 'admin',
      });
    });

    it('should reject a token with an altered character', async () => {
      const token = await service.signAccessToken({
        id: 'user-1',
        username: 'admin',
      });
      const [header, payload, signature] = token.split('.');
      const flipped = signature[0] === 'A' ? 'B' : 'A';
      await expectRejected(
        `${header}.${payload}.${flipped}${signature.slice(1)}`,
      );
    });

    it('should reject a token signed with another secret', async () => {
      const other = new JwtService({ secret: 'another-secret-another-secret' });
      await expectRejected(
        await other.signAsync({ sub: 'user-1', username: 'admin' }),
      );
    });

    it('should reject an expired token', async () => {
      const expired = await jwtService.signAsync(
        { sub: 'user-1', username: 'admin' },
        { expiresIn: -10 },
      );
      await expectRejected(expired);
    });

    it('should reject a malformed string', async () => {
      await expectRejected('not-a-jwt');
    });
  });
});
