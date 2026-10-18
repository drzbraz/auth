import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';

jest.mock('argon2', () => {
  const actual = jest.requireActual<typeof import('argon2')>('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});

describe('UsersService', () => {
  let service: UsersService;
  const env: Record<string, string | undefined> = {};
  type SeedUpdate = {
    $setOnInsert: { username: string; passwordHash: string };
  };
  const userModel = {
    create: jest.fn<
      Promise<unknown>,
      [{ username: string; passwordHash: string }]
    >(),
    findOne: jest.fn(),
    updateOne: jest.fn<unknown, [object, SeedUpdate, object]>(),
  };

  const findOneReturning = (doc: unknown) =>
    userModel.findOne.mockReturnValue({
      select: () => ({ exec: () => Promise.resolve(doc) }),
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    env.INITIAL_USER_USERNAME = 'admin';
    env.INITIAL_USER_PASSWORD = 'Secret123!';
    userModel.updateOne.mockReturnValue({ exec: () => Promise.resolve() });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('create', () => {
    it('should store an argon2id hash, never the password', async () => {
      userModel.create.mockImplementation((doc) => Promise.resolve(doc));
      await service.create('alice', 'pa55word');
      const stored = userModel.create.mock.calls[0][0];
      expect(stored.username).toBe('alice');
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(JSON.stringify(stored)).not.toContain('pa55word');
    });
  });

  describe('verifyCredentials', () => {
    let hash: string;

    beforeAll(async () => {
      hash = await argon2.hash('right', { type: argon2.argon2id });
    });

    it('should return the user for the right password', async () => {
      const user = { username: 'alice', passwordHash: hash };
      findOneReturning(user);
      await expect(service.verifyCredentials('alice', 'right')).resolves.toBe(
        user,
      );
    });

    it('should return null for a wrong password', async () => {
      findOneReturning({ username: 'alice', passwordHash: hash });
      await expect(
        service.verifyCredentials('alice', 'wrong'),
      ).resolves.toBeNull();
    });

    it('should return null for an unknown user and still run argon2.verify', async () => {
      findOneReturning(null);
      await expect(
        service.verifyCredentials('nobody', 'right'),
      ).resolves.toBeNull();
      expect(argon2.verify).toHaveBeenCalledTimes(1);
    });

    it('should propagate database errors', async () => {
      userModel.findOne.mockReturnValue({
        select: () => ({ exec: () => Promise.reject(new Error('db down')) }),
      });
      await expect(service.verifyCredentials('alice', 'x')).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('seedInitialUser', () => {
    it('should upsert with $setOnInsert so an existing password is never overwritten', async () => {
      await service.seedInitialUser();
      const [filter, update, options] = userModel.updateOne.mock.calls[0];
      expect(filter).toEqual({ username: 'admin' });
      expect(Object.keys(update)).toEqual(['$setOnInsert']);
      expect(update.$setOnInsert.passwordHash).toMatch(/^\$argon2id\$/);
      expect(options).toEqual({ upsert: true });
    });

    it('should skip seeding when the username is not configured', async () => {
      env.INITIAL_USER_USERNAME = undefined;
      await service.seedInitialUser();
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it('should skip seeding when the password is not configured', async () => {
      env.INITIAL_USER_PASSWORD = undefined;
      await service.seedInitialUser();
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });
  });
});
