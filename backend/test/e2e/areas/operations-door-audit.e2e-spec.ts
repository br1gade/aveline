import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { MONGO_CONNECTION } from '../../../src/infra/analytics/analytics.service';
import { AUDIT_COLLECTION } from '../../../src/infra/audit/audit.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

type Row = Record<string, unknown>;

/**
 * There is no MongoDB in this environment, so the audit store is an in-memory
 * stand-in for the few collection calls the trail makes. What is under test
 * is ours: that a real write through the interceptor becomes a readable entry
 * on the event's trail, newest first and bounded, behind member:manage.
 */
function memoryMongo() {
  const collections = new Map<string, Row[]>();
  const rowsOf = (name: string) => collections.get(name) ?? collections.set(name, []).get(name)!;
  const matches = (row: Row, filter: Row) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const cursor = (rows: Row[]) => ({
    sort: (spec: Record<string, 1 | -1>) => {
      const [[key, direction]] = Object.entries(spec);
      const sorted = [...rows].sort((a, b) => ((a[key] as Date).getTime() - (b[key] as Date).getTime()) * direction);
      return cursor(sorted);
    },
    limit: (count: number) => cursor(rows.slice(0, count)),
    toArray: () => Promise.resolve(rows.map((row) => ({ ...row }))),
  });
  const database = {
    collection: (name: string) => ({
      insertOne: (row: Row) => Promise.resolve(void rowsOf(name).push({ ...row })),
      insertMany: (rows: Row[]) => Promise.resolve(void rowsOf(name).push(...rows)),
      find: (filter: Row) => cursor(rowsOf(name).filter((row) => matches(row, filter))),
      createIndex: () => Promise.resolve('index'),
      aggregate: () => cursor([]),
      updateMany: () => Promise.resolve({}),
    }),
    command: () => Promise.resolve({ ok: 1 }),
  };
  return {
    rows: rowsOf,
    reset: () => collections.clear(),
    connection: { db: () => Promise.resolve(database), reportFailure: () => undefined, probe: () => Promise.resolve(), close: () => Promise.resolve() },
  };
}

describe('The audit trail (coverage, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const mongo = memoryMongo();

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(MONGO_CONNECTION)
      .useValue(mongo.connection)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    mongo.reset();
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  const owned = async () => {
    const { eventId } = await seedEvent(prisma);
    const owner = await authenticateAs(app, prisma, { eventId, role: EventRole.OWNER });
    return { eventId, ...owner };
  };

  const trail = (eventId: string, authorization?: string) => {
    const call = http().get(`/api/v1/events/${eventId}/audit-trail`);
    return authorization ? call.set('Authorization', authorization) : call;
  };

  it('shows the owner each successful write, newest first, naming who did it and never what it changed', async () => {
    const { eventId, authorization, userId } = await owned();
    await http().patch(`/api/v1/events/${eventId}/settings`).set('Authorization', authorization).send({ remindersEnabled: false }).expect(200);
    await http().post(`/api/v1/events/${eventId}/guests`).set('Authorization', authorization)
      .send({ firstName: 'Ani', lastName: 'Hakobyan', email: 'ani@example.am', attribution: 'SIDE_A' }).expect(201);

    const { body } = await trail(eventId, authorization).expect(200);

    expect(body).toHaveLength(2);
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email;
    expect(body[0]).toMatchObject({
      action: 'events.guests.create', method: 'POST', route: expect.stringMatching(/\/events\/:eventId\/guests$/),
      userId, email, eventId, statusCode: 201, requestId: expect.any(String), at: expect.any(String),
    });
    expect(body[1]).toMatchObject({ method: 'PATCH', route: expect.stringMatching(/\/events\/:id\/settings$/), eventId, statusCode: 200 });
    expect(JSON.stringify(body)).not.toMatch(/Hakobyan|ani@example\.am|remindersEnabled/);
  });

  it('records neither reads nor refused writes, only the write that succeeded', async () => {
    const { eventId, authorization } = await owned();
    await http().get(`/api/v1/events/${eventId}/guests`).set('Authorization', authorization).expect(200);
    const refused = await http().post(`/api/v1/events/${eventId}/guests`).set('Authorization', authorization).send({ firstName: 'Ani', attribution: 'NOWHERE' }).expect(400);
    expect((refused.body.details as { field: string | null }[]).map((detail) => detail.field)).toContain('attribution');
    await http().patch(`/api/v1/events/${eventId}/settings`).set('Authorization', authorization).send({ remindersEnabled: false }).expect(200);

    const { body } = await trail(eventId, authorization).expect(200);

    expect(body).toEqual([expect.objectContaining({ method: 'PATCH', statusCode: 200, eventId })]);
  });

  it('returns at most the 100 newest entries', async () => {
    const { eventId, authorization } = await owned();
    const start = Date.UTC(2026, 9, 1);
    mongo.rows(AUDIT_COLLECTION).push(...Array.from({ length: 120 }, (_, index) => ({
      action: 'events.update', method: 'PATCH', route: '/api/v1/events/:id', userId: null, email: null,
      organizationId: null, eventId, statusCode: 200, requestId: `r${index}`, at: new Date(start + index * 60_000),
    })));

    const { body } = await trail(eventId, authorization).expect(200);

    expect(body).toHaveLength(100);
    expect(body[0].requestId).toBe('r119');
    expect(body[99].requestId).toBe('r20');
  });

  it('keeps another event’s writes off this event’s trail', async () => {
    const ours = await owned();
    const theirs = await owned();
    await http().patch(`/api/v1/events/${theirs.eventId}/settings`).set('Authorization', theirs.authorization).send({ remindersEnabled: false }).expect(200);
    await http().patch(`/api/v1/events/${ours.eventId}/settings`).set('Authorization', ours.authorization).send({ remindersEnabled: true }).expect(200);

    const { body } = await trail(ours.eventId, ours.authorization).expect(200);

    expect(body).toEqual([expect.objectContaining({ eventId: ours.eventId, userId: ours.userId })]);
  });

  it.each([EventRole.COORDINATOR, EventRole.VIEWER, EventRole.DESIGNER])('refuses the trail to a %s', async (role) => {
    const { eventId } = await owned();
    const member = await authenticateAs(app, prisma, { eventId, role });

    await trail(eventId, member.authorization).expect(403);
  });

  it('refuses the trail to another event’s owner', async () => {
    const ours = await owned();
    const theirs = await owned();

    await trail(ours.eventId, theirs.authorization).expect(403);
  });

  it('refuses the trail without an account', async () => {
    const { eventId } = await owned();

    await trail(eventId).expect(401);
  });
});
