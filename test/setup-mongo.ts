import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { App } from 'supertest/types';

export const TEST_USERNAME = 'admin';
export const TEST_PASSWORD = 'Secret123!';

export async function startMongo(): Promise<MongoMemoryServer> {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.JWT_ACCESS_SECRET = 'e2e-test-secret-at-least-32-characters';
  process.env.INITIAL_USER_USERNAME = TEST_USERNAME;
  process.env.INITIAL_USER_PASSWORD = TEST_PASSWORD;
  return mongo;
}

export async function startTestApp(): Promise<{
  app: INestApplication<App>;
  connection: Connection;
}> {
  // Imported lazily: ConfigModule validates the environment when AppModule is
  // first loaded, which must happen after startMongo() has set MONGODB_URI.
  const { AppModule } =
    jest.requireActual<typeof import('../src/app.module')>('../src/app.module');
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  await app.init();
  return { app, connection: app.get<Connection>(getConnectionToken()) };
}

export async function clearSessions(connection: Connection): Promise<void> {
  await connection.collection('refreshsessions').deleteMany({});
}
