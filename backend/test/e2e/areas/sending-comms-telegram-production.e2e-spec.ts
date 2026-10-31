import type { NestExpressApplication } from '@nestjs/platform-express';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The Telegram webhook in production with no secret configured.
 *
 * Without the secret, anyone who learned a guest's token could register their
 * own chat against that guest and receive the guest's messages. Development
 * accepts unsigned updates for convenience; production must refuse every one
 * (root CLAUDE.md: development affordances must be impossible to reach in
 * production).
 *
 * NODE_ENV is production only while the app is built — ConfigModule captures
 * it then — and is put back to test afterwards so the database reset between
 * tests keeps its production refusal.
 */
const PRODUCTION = {
  NODE_ENV: 'production',
  TRUST_PROXY_HOPS: '1',
  CORS_ORIGINS: 'https://aveline.am',
  JWT_SECRET: 'production-test-secret-that-is-long-enough-to-be-real',
  PUBLIC_APP_URL: 'https://aveline.am',
  LOG_LEVEL: 'silent',
};
const UNSET = ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN'];

describe('Telegram webhook under NODE_ENV=production with no secret (e2e, coverage)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    prisma = testPrisma();
    for (const key of [...Object.keys(PRODUCTION), ...UNSET]) saved[key] = process.env[key];
    Object.assign(process.env, PRODUCTION);
    for (const key of UNSET) delete process.env[key];
    const { createApplication } = await import('../../../src/application');
    app = await createApplication();
    await app.listen(0);
    process.env.NODE_ENV = 'test';
    // Nothing here is scheduled work; a wall-clock sweep must not race the database reset.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(() => resetTestDatabase());

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await disconnectTestDatabase();
  });

  it('refuses a /start update with a 401 and links no chat to the guest', async () => {
    const { primaryGuestToken } = await seedEvent(prisma);

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/telegram')
      .send({ message: { chat: { id: 4242 }, text: `/start ${primaryGuestToken}` } })
      .expect(401);

    expect(await prisma.guestChannel.count()).toBe(0);
  });

  it('refuses an update whatever secret header it carries, since none can match', async () => {
    const { primaryGuestToken } = await seedEvent(prisma);

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', 'anything')
      .send({ message: { chat: { id: 4242 }, text: `/start ${primaryGuestToken}` } })
      .expect(401);

    expect(await prisma.guestChannel.count()).toBe(0);
  });
});
