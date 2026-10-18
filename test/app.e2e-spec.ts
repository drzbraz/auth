import { INestApplication } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { App } from 'supertest/types';
import { startMongo, startTestApp } from './setup-mongo';

describe('AppController (e2e)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication<App>;

  beforeAll(async () => {
    mongo = await startMongo();
  });

  beforeEach(async () => {
    ({ app } = await startTestApp());
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await mongo.stop();
  });
});
