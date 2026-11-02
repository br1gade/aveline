import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { EventRole, EventVisibility, PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { MONGO_CONNECTION } from '../../../src/infra/analytics/analytics.service';
import { MongoConnection } from '../../../src/infra/analytics/mongo-connection';
import { REDIS_CLIENT } from '../../../src/infra/cache/cache.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/** Nothing listens on port 1: both clients fail at once, as in a real outage. */
const UNREACHABLE_REDIS = 'redis://127.0.0.1:1';
const UNREACHABLE_MONGO = 'mongodb://127.0.0.1:1/aveline';

/**
 * GOING_LIVE.md §3: "Redis and MongoDB can both be down and the API still
 * serves correct content". Piece by piece this is covered; here the whole app
 * runs with both unreachable from boot, and a guest reads and answers while
 * the host watches the dashboard — each read must reflect the write before it.
 */
describe('Redis and MongoDB both down (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    // The production client's options (cache.module.ts), aimed at nothing.
    redis = new Redis(UNREACHABLE_REDIS, { maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => 2000 });
    redis.on('error', () => undefined);
    const mongo = new MongoConnection(() => new MongoClient(UNREACHABLE_MONGO, { serverSelectionTimeoutMS: 100, connectTimeoutMS: 100 }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(REDIS_CLIENT).useValue(redis)
      .overrideProvider(MONGO_CONNECTION).useValue(mongo)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    redis.disconnect();
    await disconnectTestDatabase();
  });

  it('reports itself degraded but ready, naming both stores as down', async () => {
    const { body } = await http().get('/api/v1/health/ready').expect(200);

    expect(body.status).toBe('degraded');
    expect(body.required.postgres.isUp).toBe(true);
    expect(body.optional.redis.isUp).toBe(false);
    expect(body.optional.mongo.isUp).toBe(false);
  });

  it('serves the invitation, takes an RSVP, and shows both the guest and the host the answer', async () => {
    const event = await seedEvent(prisma, { seatsAllotted: 2, visibility: EventVisibility.UNLISTED });
    const { authorization } = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.OWNER });
    const personalPath = `/api/v1/invitations/${event.slug}/g/${event.primaryGuestToken}`;

    const shared = await http().get(`/api/v1/invitations/${event.slug}?locale=en`).expect(200);
    expect(shared.body.locale).toBe('en');
    expect((shared.body.blocks as { type: string }[]).map((block) => block.type)).toEqual(['HERO', 'RSVP']);
    const before = await http().get(personalPath).expect(200);
    expect(before.body.guest).toMatchObject({ name: 'Primary Guest', rsvp: { status: 'PENDING' } });
    const empty = await http().get(`/api/v1/events/${event.eventId}/dashboard`).set('Authorization', authorization).expect(200);
    expect(empty.body.headcount).toMatchObject({ invited: 1, attending: 0, pending: 1 });

    await http().post(`${personalPath}/rsvp`)
      .send({ status: 'ATTENDING', party: [{ firstName: 'Companion' }], dietary: ['vegan'], songRequest: 'Sirun Yar' }).expect(201);

    const after = await http().get(personalPath).expect(200);
    expect(after.body.guest.rsvp.status).toBe('ATTENDING');
    const dashboard = await http().get(`/api/v1/events/${event.eventId}/dashboard`).set('Authorization', authorization).expect(200);
    expect(dashboard.body.headcount).toMatchObject({ invited: 2, attending: 2, pending: 0, responseRate: 100 });
    expect(dashboard.body.catering.covers).toBe(2);
    expect(dashboard.body.playlist.tracks).toContainEqual({ track: 'Sirun Yar', requests: 1 });
  });

  it('still lets a guest change their answer, and the host sees the change', async () => {
    const event = await seedEvent(prisma, { seatsAllotted: 1 });
    const { authorization } = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.OWNER });
    const rsvp = `/api/v1/invitations/${event.slug}/g/${event.primaryGuestToken}/rsvp`;
    await http().post(rsvp).send({ status: 'ATTENDING' }).expect(201);
    const first = await http().get(`/api/v1/events/${event.eventId}/dashboard`).set('Authorization', authorization).expect(200);
    expect(first.body.headcount).toMatchObject({ attending: 1, declined: 0 });
    const page = await http().get(`/api/v1/invitations/${event.slug}/g/${event.primaryGuestToken}`).expect(200);

    await http().post(rsvp).send({ status: 'DECLINED', attendanceRevision: page.body.guest.attendance.revision }).expect(201);

    const second = await http().get(`/api/v1/events/${event.eventId}/dashboard`).set('Authorization', authorization).expect(200);
    expect(second.body.headcount).toMatchObject({ attending: 0, declined: 1 });
  });
});
