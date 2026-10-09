import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Arranging the room. A table's name, size and place could not be changed
 * after it was made — only deleted while empty and made again — and the
 * canvas position a drag-and-drop plan needs was never stored.
 */
describe('Editing tables (e2e)', () => {
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  const planner = async (role: EventRole = EventRole.COORDINATOR) => {
    const seeded = await seedEvent(prisma, { seatsAllotted: 8 });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    const table = await prisma.table.create({ data: { eventId: seeded.eventId, name: 'Table 1', capacity: 2 } });
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId: seeded.eventId } });
    return { ...seeded, authorization, tableId: table.id, venueId: venue.id };
  };

  const edit = (eventId: string, tableId: string, authorization: string, body: Record<string, unknown>) =>
    http().patch(`/api/v1/events/${eventId}/tables/${tableId}`).set('Authorization', authorization).send(body);

  /** Adds a guest and seats them at the table; resolves to the HTTP status. */
  const seat = async (eventId: string, tableId: string, authorization: string, firstName: string) => {
    const household = await prisma.household.findFirstOrThrow({ where: { eventId } });
    const guest = await prisma.guest.create({
      data: { eventId, householdId: household.id, firstName, token: `${firstName}-${tableId}` },
    });
    const response = await http()
      .post(`/api/v1/events/${eventId}/seats`)
      .set('Authorization', authorization)
      .send({ guestId: guest.id, tableId });
    return response.status;
  };

  it('renames, resizes, places and reshapes a table, and the plan reads it back', async () => {
    const { eventId, tableId, venueId, authorization } = await planner();

    await edit(eventId, tableId, authorization, {
      name: 'Head table',
      capacity: 12,
      zone: 'terrace',
      venueId,
      posX: 120.5,
      posY: 40,
      shape: 'rectangle',
    }).expect(200);

    const { body } = await http().get(`/api/v1/events/${eventId}/tables`).set('Authorization', authorization).expect(200);
    expect(body[0]).toMatchObject({
      name: 'Head table',
      capacity: 12,
      zone: 'terrace',
      venueId,
      posX: 120.5,
      posY: 40,
      shape: 'rectangle',
    });
  });

  it('clears the zone and venue sent as null, and leaves the rest alone', async () => {
    const { eventId, tableId, venueId, authorization } = await planner();
    await edit(eventId, tableId, authorization, { zone: 'terrace', venueId }).expect(200);

    const { body } = await edit(eventId, tableId, authorization, { zone: null, venueId: null }).expect(200);

    expect(body).toMatchObject({ name: 'Table 1', capacity: 2, zone: null, venueId: null });
  });

  it('never shrinks a table below the people already seated at it', async () => {
    const { eventId, tableId, authorization } = await planner();
    expect(await seat(eventId, tableId, authorization, 'Ani')).toBe(201);
    expect(await seat(eventId, tableId, authorization, 'Aram')).toBe(201);

    const { body } = await edit(eventId, tableId, authorization, { capacity: 1 }).expect(400);

    expect(body.message).toMatch(/^capacity: /);
    await edit(eventId, tableId, authorization, { capacity: 2 }).expect(200);
  });

  it('refuses a name another table already has, naming the field', async () => {
    const { eventId, tableId, authorization } = await planner();
    await prisma.table.create({ data: { eventId, name: 'Table 2', capacity: 8 } });

    const { body } = await edit(eventId, tableId, authorization, { name: 'Table 2' }).expect(400);

    expect(body.message).toMatch(/^name: /);
  });

  // A table pointing at another event's venue also stopped that event deleting its own venue.
  it('refuses a venue from another event, when creating or editing', async () => {
    const { eventId, tableId, authorization } = await planner();
    const other = await seedEvent(prisma);
    const foreign = await prisma.venue.findFirstOrThrow({ where: { eventId: other.eventId } });

    await edit(eventId, tableId, authorization, { venueId: foreign.id }).expect(400);
    await http()
      .post(`/api/v1/events/${eventId}/tables`)
      .set('Authorization', authorization)
      .send({ name: 'Table 9', capacity: 8, venueId: foreign.id })
      .expect(400);
  });

  it.each([
    [{ shape: 'hexagon' }, 'shape'],
    [{ capacity: 0 }, 'capacity'],
    [{ posX: 'left' }, 'posX'],
  ])('rejects %j with a 400 naming %s', async (payload, field) => {
    const { eventId, tableId, authorization } = await planner();

    const { body } = await edit(eventId, tableId, authorization, payload).expect(400);

    expect(JSON.stringify(body.message)).toContain(field);
  });

  // Two planners seating the last chair at once must not both succeed.
  it('seats only as many as the table holds when several are seated at once', async () => {
    const { eventId, tableId, authorization } = await planner();

    const statuses = await Promise.all(
      ['Ani', 'Aram', 'Lusine', 'Narek', 'Mariam', 'Tigran'].map((name) => seat(eventId, tableId, authorization, name)),
    );

    expect(statuses.filter((status) => status === 201)).toHaveLength(2);
    expect(await prisma.seat.count({ where: { tableId } })).toBe(2);
  });

  // B44: names continued from the table count, so after a deletion they
  // collided with ones still there and were silently skipped.
  it('creates every table asked for after one was deleted, numbering on from the highest', async () => {
    const { eventId, tableId, authorization } = await planner();
    const bulk = (count: number) =>
      http().post(`/api/v1/events/${eventId}/tables/bulk`).set('Authorization', authorization).send({ namePrefix: 'Table', count, capacity: 8 });
    await bulk(3).expect(201);
    await http().delete(`/api/v1/events/${eventId}/tables/${tableId}`).set('Authorization', authorization).expect(200);

    const { body } = await bulk(2).expect(201);

    expect(body).toEqual({ created: 2 });
    const names = (await prisma.table.findMany({ where: { eventId } })).map((table) => table.name);
    expect(names.sort()).toEqual(['Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6']);
  });

  it('refuses a viewer', async () => {
    const { eventId, tableId, authorization } = await planner(EventRole.VIEWER);

    await edit(eventId, tableId, authorization, { name: 'Mine now' }).expect(403);
  });
});
