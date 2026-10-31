import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/** Manual seating and the auto-seating entry point over HTTP (docs/API.md "Tables and seating"). */
describe('Seating coverage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  /** One event, a coordinator, a capacity-2 table and two unseated guests. */
  const planner = async () => {
    const seeded = await seedEvent(prisma, { seatsAllotted: 4 });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role: 'COORDINATOR' });
    const table = await prisma.table.create({ data: { eventId: seeded.eventId, name: 'Table 1', capacity: 2 } });
    const primary = await prisma.guest.findUniqueOrThrow({ where: { token: seeded.primaryGuestToken } });
    const second = await prisma.guest.create({
      data: { eventId: seeded.eventId, householdId: seeded.householdId, firstName: 'Second', token: randomUUID() },
    });
    return { ...seeded, authorization, tableId: table.id, primary, second, base: `/api/v1/events/${seeded.eventId}` };
  };

  const seat = (base: string, authorization: string, body: Record<string, unknown>) =>
    http().post(`${base}/seats`).set('Authorization', authorization).send(body);

  it('reports seated and available chairs with a confirmed guest’s name and chair, not as a reservation', async () => {
    const event = await planner();
    await prisma.rsvp.update({ where: { guestId: event.primary.id }, data: { status: 'ATTENDING' } });
    await seat(event.base, event.authorization, { guestId: event.primary.id, tableId: event.tableId, position: 2 }).expect(201);

    const { body } = await http().get(`${event.base}/tables`).set('Authorization', event.authorization).expect(200);

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: event.tableId,
      capacity: 2,
      seated: 1,
      available: 1,
      guests: [{ guestId: event.primary.id, name: 'Primary Guest', position: 2, isReservation: false }],
      released: [],
    });
  });

  it('marks a seated guest who has not confirmed attendance as a reservation', async () => {
    const event = await planner();
    await seat(event.base, event.authorization, { guestId: event.primary.id, tableId: event.tableId }).expect(201);

    const { body } = await http().get(`${event.base}/tables`).set('Authorization', event.authorization).expect(200);

    expect(body[0].guests).toEqual([{ guestId: event.primary.id, name: 'Primary Guest', position: null, isReservation: true }]);
  });

  it('reports a table with nobody at it as fully available', async () => {
    const event = await planner();

    const { body } = await http().get(`${event.base}/tables`).set('Authorization', event.authorization).expect(200);

    expect(body[0]).toMatchObject({ seated: 0, available: 2, guests: [] });
  });

  it('refuses a numbered chair that is already taken with 409 naming position, keeping the first seat', async () => {
    const event = await planner();
    await seat(event.base, event.authorization, { guestId: event.primary.id, tableId: event.tableId, position: 1 }).expect(201);

    const taken = await seat(event.base, event.authorization, { guestId: event.second.id, tableId: event.tableId, position: 1 });

    expect(taken.status).toBe(409);
    expect(taken.body.message).toMatch(/^position:/);
    expect(await prisma.seat.findMany({ select: { guestId: true, position: true } })).toEqual([{ guestId: event.primary.id, position: 1 }]);
  });

  it('accepts the last numbered chair of a table and refuses one past its capacity with 400 naming position', async () => {
    const event = await planner();

    const outside = await seat(event.base, event.authorization, { guestId: event.second.id, tableId: event.tableId, position: 3 });
    expect(outside.status).toBe(400);
    expect(outside.body.message).toMatch(/^position: outside/);
    expect(await prisma.seat.count()).toBe(0);

    await seat(event.base, event.authorization, { guestId: event.second.id, tableId: event.tableId, position: 2 }).expect(201);
    expect(await prisma.seat.count()).toBe(1);
  });

  it('refuses with 404 to seat another event’s guest at this event’s table, and writes nothing', async () => {
    const event = await planner();
    const other = await seedEvent(prisma);
    const foreignGuest = await prisma.guest.findUniqueOrThrow({ where: { token: other.primaryGuestToken } });

    const refused = await seat(event.base, event.authorization, { guestId: foreignGuest.id, tableId: event.tableId });

    expect(refused.status).toBe(404);
    expect(refused.body.message).toBe('That guest is not on this event');
    expect(await prisma.seat.count()).toBe(0);
  });

  it('refuses with 404 to seat this event’s guest at another event’s table, and writes nothing', async () => {
    const event = await planner();
    const other = await seedEvent(prisma);
    const foreignTable = await prisma.table.create({ data: { eventId: other.eventId, name: 'Foreign', capacity: 4 } });

    const refused = await seat(event.base, event.authorization, { guestId: event.primary.id, tableId: foreignTable.id });

    expect(refused.status).toBe(404);
    expect(refused.body.message).toBe('That table is not on this event');
    expect(await prisma.seat.count()).toBe(0);
  });

  it('refuses to start automatic seating on an archived event with 409 and queues no job', async () => {
    const event = await planner();
    await prisma.rsvp.updateMany({ where: { guest: { eventId: event.eventId } }, data: { status: 'ATTENDING' } });
    await prisma.event.update({ where: { id: event.eventId }, data: { status: 'ARCHIVED' } });

    const refused = await http().post(`${event.base}/seats/auto-assign`).set('Authorization', event.authorization)
      .send({ idempotencyKey: randomUUID() });

    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('Archived events cannot start or apply automatic seating');
    expect(await prisma.seatingJob.count()).toBe(0);
    expect(await prisma.seat.count()).toBe(0);
  });
});
