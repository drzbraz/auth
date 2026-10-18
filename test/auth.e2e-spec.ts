import { INestApplication } from '@nestjs/common';
import { Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  TEST_PASSWORD,
  TEST_USERNAME,
  clearSessions,
  startMongo,
  startTestApp,
} from './setup-mongo';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const tokensOf = (res: request.Response) => res.body as Tokens;
const messageOf = (res: request.Response) =>
  (res.body as { message: string }).message;

describe('Auth (e2e)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication<App>;
  let connection: Connection;

  const login = (body: object = credentials) =>
    request(app.getHttpServer()).post('/auth/login').send(body);
  const credentials = { username: TEST_USERNAME, password: TEST_PASSWORD };

  beforeAll(async () => {
    mongo = await startMongo();
  });

  beforeEach(async () => {
    ({ app, connection } = await startTestApp());
    await clearSessions(connection);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await mongo.stop();
  });

  describe('POST /auth/login', () => {
    it('should return an access token (JWT) and a refresh token', async () => {
      const res = await login().expect(200);
      expect(tokensOf(res).accessToken.split('.')).toHaveLength(3);
      expect(typeof tokensOf(res).refreshToken).toBe('string');
    });

    it('should return identical 401 bodies for wrong password and unknown user', async () => {
      const wrongPassword = await login({
        username: TEST_USERNAME,
        password: 'wrong',
      }).expect(401);
      const unknownUser = await login({
        username: 'nobody',
        password: TEST_PASSWORD,
      }).expect(401);
      expect(wrongPassword.body).toEqual(unknownUser.body);
      expect(messageOf(wrongPassword)).toBe('Invalid credentials');
    });

    it.each([
      ['an empty body', {}],
      ['empty strings', { username: '', password: '' }],
      ['an unexpected field', { ...credentials, x: 1 }],
      ['non-string values', { username: 1, password: true }],
    ])('should return 400 for %s', async (_label, body) => {
      await login(body).expect(400);
    });

    it('should still log in after the app restarts on the same database', async () => {
      await login().expect(200);
      await app.close();
      ({ app, connection } = await startTestApp());
      await login().expect(200);
    });

    it('should store the password only as an argon2id hash', async () => {
      const user = await connection
        .collection('users')
        .findOne({ username: TEST_USERNAME });
      expect(user).toMatchObject({
        passwordHash: expect.stringMatching(/^\$argon2id\$/) as string,
      });
      expect(JSON.stringify(user)).not.toContain(TEST_PASSWORD);
    });

    it('should issue an access token with sub, username and a 15 minute lifetime', async () => {
      const res = await login().expect(200);
      const payload = JSON.parse(
        Buffer.from(
          tokensOf(res).accessToken.split('.')[1],
          'base64url',
        ).toString(),
      ) as { sub: string; username: string; iat: number; exp: number };
      const user = await connection
        .collection('users')
        .findOne({ username: TEST_USERNAME });
      expect(payload.sub).toBe(user?._id.toString());
      expect(payload.username).toBe(TEST_USERNAME);
      expect(payload.exp - payload.iat).toBe(900);
    });

    it('should log in in under 1 second at p95 over 20 sequential logins', async () => {
      const durations: number[] = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        await login().expect(200);
        durations.push(performance.now() - start);
      }
      durations.sort((a, b) => a - b);
      expect(durations[Math.ceil(0.95 * durations.length) - 1]).toBeLessThan(
        1000,
      );
    });
  });

  describe('POST /auth/refresh', () => {
    const refresh = (body: object) =>
      request(app.getHttpServer()).post('/auth/refresh').send(body);

    it('should return a new access token and a different refresh token', async () => {
      const first = tokensOf(await login().expect(200));
      const res = await refresh({ refreshToken: first.refreshToken }).expect(
        200,
      );
      expect(tokensOf(res).accessToken.split('.')).toHaveLength(3);
      expect(typeof tokensOf(res).refreshToken).toBe('string');
      expect(tokensOf(res).refreshToken).not.toBe(first.refreshToken);
    });

    it('should reject a reused token and then revoke the rotated one too', async () => {
      const first = tokensOf(await login().expect(200));
      const second = tokensOf(
        await refresh({ refreshToken: first.refreshToken }).expect(200),
      );

      const reuse = await refresh({ refreshToken: first.refreshToken }).expect(
        401,
      );
      expect(messageOf(reuse)).toBe('Invalid or expired refresh token');
      await refresh({ refreshToken: second.refreshToken }).expect(401);
    });

    it('should let at most one concurrent refresh succeed and revoke every session', async () => {
      const first = tokensOf(await login().expect(200));
      const results = await Promise.all([
        refresh({ refreshToken: first.refreshToken }),
        refresh({ refreshToken: first.refreshToken }),
      ]);

      const winners = results.filter((r) => r.status === 200);
      expect(winners.length).toBeLessThanOrEqual(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(
        2 - winners.length,
      );
      for (const winner of winners) {
        await refresh({ refreshToken: tokensOf(winner).refreshToken }).expect(
          401,
        );
      }
    });

    it('should reject an expired refresh token', async () => {
      const body = tokensOf(await login().expect(200));
      await connection
        .collection('refreshsessions')
        .updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      await refresh({ refreshToken: body.refreshToken }).expect(401);
    });

    it.each([
      ['an empty body', {}],
      ['an empty token', { refreshToken: '' }],
    ])('should return 400 for %s', async (_label, body) => {
      await refresh(body).expect(400);
    });

    it('should accept a refresh token issued before an app restart', async () => {
      const body = tokensOf(await login().expect(200));
      await app.close();
      ({ app, connection } = await startTestApp());
      await refresh({ refreshToken: body.refreshToken }).expect(200);
    });

    it('should store only a SHA-256 hash of the refresh token', async () => {
      const body = tokensOf(await login().expect(200));
      const sessions = await connection
        .collection('refreshsessions')
        .find()
        .toArray();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      });
      expect(JSON.stringify(sessions)).not.toContain(body.refreshToken);
    });
  });

  describe('POST /auth/logout', () => {
    const logout = (body: object) =>
      request(app.getHttpServer()).post('/auth/logout').send(body);
    const refresh = (refreshToken: string) =>
      request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });

    it('should log out and make the refresh token unusable', async () => {
      const body = tokensOf(await login().expect(200));
      const res = await logout({ accessToken: body.accessToken }).expect(200);
      expect(res.body).toEqual({ message: 'Logged out successfully' });
      await refresh(body.refreshToken).expect(401);
    });

    it('should revoke every session of the user', async () => {
      const first = tokensOf(await login().expect(200));
      const second = tokensOf(await login().expect(200));
      await logout({ accessToken: first.accessToken }).expect(200);
      await refresh(first.refreshToken).expect(401);
      await refresh(second.refreshToken).expect(401);
    });

    it('should succeed when logging out twice with the same token', async () => {
      const body = tokensOf(await login().expect(200));
      await logout({ accessToken: body.accessToken }).expect(200);
      await logout({ accessToken: body.accessToken }).expect(200);
    });

    it('should return 401 for a tampered access token', async () => {
      const body = tokensOf(await login().expect(200));
      const [header, payload, signature] = body.accessToken.split('.');
      const flipped = signature[0] === 'A' ? 'B' : 'A';
      const res = await logout({
        accessToken: `${header}.${payload}.${flipped}${signature.slice(1)}`,
      }).expect(401);
      expect(messageOf(res)).toBe('Invalid or expired access token');
    });

    it.each([
      ['an empty body', {}],
      ['an empty token', { accessToken: '' }],
    ])('should return 400 for %s', async (_label, body) => {
      await logout(body).expect(400);
    });
  });
});
