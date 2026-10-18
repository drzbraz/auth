import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TokensService } from './tokens.service';
import { RefreshSession } from './schemas/refresh-session.schema';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = { verifyCredentials: jest.fn(), findById: jest.fn() };
  const tokensService = {
    issueTokenPair: jest.fn(),
    hashToken: jest.fn((t: string) => `hash:${t}`),
    createRefreshSession: jest.fn(),
    signAccessToken: jest.fn(),
    verifyAccessToken: jest.fn(),
  };
  const sessionModel = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
  };
  const query = (value: unknown) => ({ exec: () => Promise.resolve(value) });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: TokensService, useValue: tokensService },
        { provide: getModelToken(RefreshSession.name), useValue: sessionModel },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    const dto = { username: 'admin', password: 'Secret123!' };

    it('should return a token pair for valid credentials', async () => {
      const user = { _id: new Types.ObjectId(), username: 'admin' };
      const pair = { accessToken: 'a', refreshToken: 'r' };
      usersService.verifyCredentials.mockResolvedValue(user);
      tokensService.issueTokenPair.mockResolvedValue(pair);

      await expect(service.login(dto)).resolves.toBe(pair);
      expect(tokensService.issueTokenPair).toHaveBeenCalledWith(user);
    });

    it('should throw the same UnauthorizedException for wrong password and unknown user', async () => {
      usersService.verifyCredentials.mockResolvedValue(null);
      const error = await service.login(dto).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(
        'Invalid credentials',
      );
      expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('should propagate database errors without issuing tokens', async () => {
      usersService.verifyCredentials.mockRejectedValue(new Error('db down'));
      await expect(service.login(dto)).rejects.toThrow('db down');
      expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const userId = new Types.ObjectId();
    const oldSessionId = new Types.ObjectId();
    const newSessionId = new Types.ObjectId();
    const user = { _id: userId, username: 'admin' };

    beforeEach(() => {
      sessionModel.updateOne.mockReturnValue(query(undefined));
      sessionModel.updateMany.mockReturnValue(query(undefined));
      usersService.findById.mockResolvedValue(user);
      tokensService.createRefreshSession.mockResolvedValue({
        token: 'R2',
        sessionId: newSessionId,
      });
      tokensService.signAccessToken.mockResolvedValue('A2');
    });

    it('should consume an active token and return a new pair', async () => {
      sessionModel.findOneAndUpdate
        .mockReturnValueOnce(query({ _id: oldSessionId, userId }))
        .mockReturnValueOnce(query({ _id: oldSessionId, revokedAt: null }));

      await expect(service.refresh('R1')).resolves.toEqual({
        accessToken: 'A2',
        refreshToken: 'R2',
      });

      expect(sessionModel.findOneAndUpdate).toHaveBeenNthCalledWith(
        1,
        {
          tokenHash: 'hash:R1',
          usedAt: null,
          revokedAt: null,
          expiresAt: { $gt: expect.any(Date) as Date },
        },
        { $set: { usedAt: expect.any(Date) as Date } },
      );
      expect(sessionModel.findOneAndUpdate).toHaveBeenNthCalledWith(
        2,
        { _id: oldSessionId },
        { $set: { replacedBy: newSessionId } },
        { new: true },
      );
    });

    it('should revoke all user sessions when an already-used token is presented', async () => {
      sessionModel.findOneAndUpdate.mockReturnValueOnce(query(null));
      sessionModel.findOne.mockReturnValue(
        query({ userId, usedAt: new Date(), revokedAt: null }),
      );

      await expect(service.refresh('R1')).rejects.toThrow(
        new UnauthorizedException('Invalid or expired refresh token'),
      );
      expect(sessionModel.updateMany).toHaveBeenCalledWith(
        { userId, revokedAt: null },
        { $set: { revokedAt: expect.any(Date) as Date } },
      );
    });

    it.each([
      ['unknown', null],
      ['expired', { userId, usedAt: null, expiresAt: new Date(0) }],
      ['revoked', { userId, usedAt: null, revokedAt: new Date() }],
    ])(
      'should reject an %s token without bulk revoke',
      async (_label, existing) => {
        sessionModel.findOneAndUpdate.mockReturnValueOnce(query(null));
        sessionModel.findOne.mockReturnValue(query(existing));

        await expect(service.refresh('R1')).rejects.toThrow(
          UnauthorizedException,
        );
        expect(sessionModel.updateMany).not.toHaveBeenCalled();
        expect(tokensService.createRefreshSession).not.toHaveBeenCalled();
      },
    );

    it('should revoke the new session if the old one was revoked concurrently', async () => {
      sessionModel.findOneAndUpdate
        .mockReturnValueOnce(query({ _id: oldSessionId, userId }))
        .mockReturnValueOnce(
          query({ _id: oldSessionId, revokedAt: new Date() }),
        );

      await expect(service.refresh('R1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionModel.updateOne).toHaveBeenCalledWith(
        { _id: newSessionId },
        { $set: { revokedAt: expect.any(Date) as Date } },
      );
      expect(tokensService.signAccessToken).not.toHaveBeenCalled();
    });

    it('should propagate database errors without issuing tokens', async () => {
      sessionModel.findOneAndUpdate.mockReturnValueOnce({
        exec: () => Promise.reject(new Error('db down')),
      });

      await expect(service.refresh('R1')).rejects.toThrow('db down');
      expect(tokensService.createRefreshSession).not.toHaveBeenCalled();
      expect(tokensService.signAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    const userId = new Types.ObjectId();

    beforeEach(() => {
      sessionModel.updateMany.mockReturnValue(query(undefined));
    });

    it('should revoke all refresh sessions of the token user', async () => {
      tokensService.verifyAccessToken.mockResolvedValue({
        sub: userId.toString(),
        username: 'admin',
      });

      await service.logout('A1');

      expect(sessionModel.updateMany).toHaveBeenCalledWith(
        { userId, revokedAt: null },
        { $set: { revokedAt: expect.any(Date) as Date } },
      );
    });

    it('should propagate UnauthorizedException for an invalid token', async () => {
      tokensService.verifyAccessToken.mockRejectedValue(
        new UnauthorizedException('Invalid or expired access token'),
      );

      await expect(service.logout('bad')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionModel.updateMany).not.toHaveBeenCalled();
    });

    it('should succeed when called twice with the same token', async () => {
      tokensService.verifyAccessToken.mockResolvedValue({
        sub: userId.toString(),
        username: 'admin',
      });

      await service.logout('A1');
      await expect(service.logout('A1')).resolves.toBeUndefined();
    });
  });
});
