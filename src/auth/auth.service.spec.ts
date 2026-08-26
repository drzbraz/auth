import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should return tokens for valid credentials', () => {
      const result = service.login({ username: 'admin', password: 'secret' });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('should throw UnauthorizedException for invalid password', () => {
      expect(() =>
        service.login({ username: 'admin', password: 'wrong' }),
      ).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for unknown user', () => {
      expect(() =>
        service.login({ username: 'nobody', password: 'secret' }),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('should return a new access token for a valid refresh token', () => {
      const { refreshToken } = service.login({
        username: 'admin',
        password: 'secret',
      });
      const result = service.refresh(refreshToken);
      expect(result).toHaveProperty('accessToken');
      expect(typeof result.accessToken).toBe('string');
    });

    it('should throw UnauthorizedException for invalid refresh token', () => {
      expect(() => service.refresh('invalid-token')).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw BadRequestException when refresh token is empty', () => {
      expect(() => service.refresh('')).toThrow(BadRequestException);
    });
  });

  describe('logout', () => {
    it('should logout successfully with a valid access token', () => {
      const { accessToken } = service.login({
        username: 'admin',
        password: 'secret',
      });
      expect(() => service.logout(accessToken)).not.toThrow();
    });

    it('should throw UnauthorizedException after logout with same token', () => {
      const { accessToken } = service.login({
        username: 'admin',
        password: 'secret',
      });
      service.logout(accessToken);
      expect(() => service.logout(accessToken)).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid access token', () => {
      expect(() => service.logout('invalid-token')).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw BadRequestException when access token is empty', () => {
      expect(() => service.logout('')).toThrow(BadRequestException);
    });
  });
});
