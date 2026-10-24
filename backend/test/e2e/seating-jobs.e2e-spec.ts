import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SeatingRunner } from '../../src/modules/seating/jobs/seating-runner';
import { SeatingPlanner } from '../../src/modules/seating/jobs/seating-planner';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Queued seating contract (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    prisma = testPrisma();
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  const setup = async () => {
    const event = await seedEvent(prisma);
    const actor = await authenticateAs(app, prisma, { eventId: event.eventId, role: 'COORDINATOR' });
    await prisma.rsvp.updateMany({ where: { guest: { eventId: event.eventId } }, data: { status: 'ATTENDING' } });
    await prisma.table.create({ data: { eventId: event.eventId, name: 'One', capacity: 4 } });
    return { ...event, ...actor, base: `/api/v1/events/${event.eventId}` };
  };
  it('localizes actionable unseated explanations while retaining the stored reason', async () => {
    const event = await setup();
    await prisma.table.deleteMany({ where: { eventId: event.eventId } });
    const accepted = await http().post(`${event.base}/seats/auto-assign`).set('Authorization', event.authorization).send({ idempotencyKey: randomUUID() }).expect(201);
    const id = (accepted.body as { id: string }).id;
    await app.get(SeatingRunner).runOne();
    const response = await http().get(`${event.base}/seating/jobs/${id}`).set('Authorization', event.authorization).set('Accept-Language', 'fr').expect(200);
    expect(response.body).toMatchObject({ status: 'COMPLETED', result: { unseated: [{
      reason: 'No tables have been created for this seating arrangement',
      explanation: { code: 'SEATING_NO_TABLES', locale: 'fr', action: 'EDIT' },
    }] } });
  });
  it('returns a queued resource without running the planner, then exposes its committed result', async () => {
    const event = await setup();
    const plan = jest.spyOn(app.get(SeatingPlanner), 'plan');
    const intent = { idempotencyKey: randomUUID() };
    const accepted = await http().post(`${event.base}/seats/auto-assign`).set('Authorization', event.authorization).send(intent).expect(201);
    const id = (accepted.body as { id: string }).id;
    expect(accepted.body).toMatchObject({ status: 'QUEUED', result: null, attempts: 0 });
    expect(plan).not.toHaveBeenCalled();
    expect(await prisma.seat.count()).toBe(0);
    const retry = await http().post(`${event.base}/seats/auto-assign`).set('Authorization', event.authorization).send(intent).expect(201);
    expect((retry.body as { id: string }).id).toBe(id);
    await http().post(`${event.base}/seats/auto-assign`).set('Authorization', event.authorization).send({ idempotencyKey: randomUUID() }).expect(409);
    await app.get(SeatingRunner).runOne();
    const completed = await http().get(`${event.base}/seating/jobs/${id}`).set('Authorization', event.authorization).expect(200);
    expect(completed.body).toMatchObject({ status: 'COMPLETED', result: { seated: 1, households: 1, unseated: [] } });
    expect(JSON.stringify(completed.body)).not.toMatch(/leaseOwner|leaseUntil|token|guestIds/);
    const history = await http().get(`${event.base}/seating/jobs`).set('Authorization', event.authorization).expect(200);
    expect(history.body).toMatchObject([{ id, status: 'COMPLETED' }]);
    expect((history.body as object[])[0]).not.toHaveProperty('result');
  });
  it.each([{}, { idempotencyKey: 'bad' }, { idempotencyKey: randomUUID(), force: true }])('rejects malformed intents without accepting work: %j', async (body) => {
    const event = await setup();
    await http().post(`${event.base}/seats/auto-assign`).set('Authorization', event.authorization).send(body).expect(400);
    expect(await prisma.seatingJob.count()).toBe(0);
  });
  it('enforces write/read permissions, authentication and event scoping', async () => {
    const event = await setup();
    const viewer = await authenticateAs(app, prisma, { eventId: event.eventId, role: 'VIEWER' });
    const accepted = await http().post(`${event.base}/seats/auto-assign`).set('Authorization', event.authorization).send({ idempotencyKey: randomUUID() }).expect(201);
    const id = (accepted.body as { id: string }).id;
    await http().post(`${event.base}/seats/auto-assign`).set('Authorization', viewer.authorization).send({ idempotencyKey: randomUUID() }).expect(403);
    await http().get(`${event.base}/seating/jobs/${id}`).set('Authorization', viewer.authorization).expect(200);
    await http().get(`${event.base}/seating/jobs/${id}`).expect(401);
    const other = await seedEvent(prisma);
    const outsider = await authenticateAs(app, prisma, { eventId: other.eventId });
    await http().get(`${event.base}/seating/jobs/${id}`).set('Authorization', outsider.authorization).expect(403);
    await http().get(`/api/v1/events/${other.eventId}/seating/jobs/${id}`).set('Authorization', outsider.authorization).expect(404);
    await http().post(`${event.base}/seats/auto-assign?arrangementId=foreign`).set('Authorization', event.authorization).send({ idempotencyKey: randomUUID() }).expect(404);
  });
});
