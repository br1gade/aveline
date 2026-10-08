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
 * The host's edits to a guest list, over HTTP. The rules themselves — capacity,
 * primaries, emptied households, races — are proven against Postgres in the
 * integration suite; this is what a client sees: status codes, which field a
 * refusal names, who may call it, and the shape that comes back.
 */
describe('Guest management (e2e)', () => {
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

  const signedIn = async (role: EventRole = EventRole.COORDINATOR) => {
    const seeded = await seedEvent(prisma, { seatsAllotted: 3 });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    return { ...seeded, authorization };
  };

  const addGuest = (eventId: string, authorization: string, body: Record<string, unknown>) =>
    http().post(`/api/v1/events/${eventId}/guests`).set('Authorization', authorization).send(body);

  it('adds a guest and returns them with their household and link token', async () => {
    const { eventId, authorization } = await signedIn();

    const { body } = await addGuest(eventId, authorization, {
      firstName: 'Ani',
      lastName: 'Hakobyan',
      email: 'ani@example.am',
      attribution: 'SIDE_A',
    }).expect(201);

    expect(body).toEqual({
      id: expect.any(String),
      householdId: expect.any(String),
      firstName: 'Ani',
      lastName: 'Hakobyan',
      email: 'ani@example.am',
      phone: null,
      locale: null,
      attribution: 'SIDE_A',
      isPrimary: true,
      token: expect.any(String),
    });

    const list = await http()
      .get(`/api/v1/events/${eventId}/guests`)
      .set('Authorization', authorization)
      .expect(200);
    const household = (list.body as { id: string; seatsNamed: number }[]).find((h) => h.id === body.householdId);
    expect(household?.seatsNamed).toBe(1);
  });

  it.each([
    [{}, 'firstName'],
    [{ firstName: 'Ani', seatsAllotted: 0 }, 'seatsAllotted'],
    [{ firstName: 'Ani', seatsAllotted: 21 }, 'seatsAllotted'],
    [{ firstName: 'Ani', email: 'not-an-address' }, 'email'],
    [{ firstName: 'Ani', attribution: 'BRIDE' }, 'attribution'],
    [{ firstName: 'Ani', isPrimary: true }, 'isPrimary'],
  ])('rejects %j with a 400 naming %s', async (payload, field) => {
    const { eventId, authorization } = await signedIn();

    const { body } = await addGuest(eventId, authorization, payload).expect(400);

    expect(JSON.stringify(body.message)).toContain(field);
  });

  it('refuses a full household with a 400 naming householdId', async () => {
    const { eventId, householdId, authorization } = await signedIn();
    await addGuest(eventId, authorization, { firstName: 'Lusine', householdId }).expect(201);
    await addGuest(eventId, authorization, { firstName: 'Narek', householdId }).expect(201);

    const { body } = await addGuest(eventId, authorization, { firstName: 'Mariam', householdId }).expect(400);

    expect(body.message).toMatch(/^householdId: /);
  });

  it('edits only what was sent', async () => {
    const { eventId, authorization } = await signedIn();
    const added = await addGuest(eventId, authorization, { firstName: 'Ani', phone: '+374 91 000000' });

    const { body } = await http()
      .patch(`/api/v1/events/${eventId}/guests/${added.body.id}`)
      .set('Authorization', authorization)
      .send({ lastName: 'Hakobyan' })
      .expect(200);

    expect(body).toMatchObject({ firstName: 'Ani', lastName: 'Hakobyan', phone: '+374 91 000000' });
  });

  it('removes a guest, and the household they leave empty', async () => {
    const { eventId, authorization } = await signedIn();
    const added = await addGuest(eventId, authorization, { firstName: 'Ani' });

    const { body } = await http()
      .delete(`/api/v1/events/${eventId}/guests/${added.body.id}`)
      .set('Authorization', authorization)
      .expect(200);

    expect(body).toEqual({ removed: added.body.id, isHouseholdRemoved: true });
  });

  it('refuses to remove a checked-in guest with a 400 saying why', async () => {
    const { eventId, authorization } = await signedIn();
    const added = await addGuest(eventId, authorization, { firstName: 'Ani' });
    await http()
      .post(`/api/v1/events/${eventId}/guests/${added.body.id}/check-in`)
      .set('Authorization', authorization)
      .expect(201);

    const { body } = await http()
      .delete(`/api/v1/events/${eventId}/guests/${added.body.id}`)
      .set('Authorization', authorization)
      .expect(400);

    expect(body.message).toMatch(/checked in/);
  });

  it('renames a household and changes its seats', async () => {
    const { eventId, householdId, authorization } = await signedIn();

    const { body } = await http()
      .patch(`/api/v1/events/${eventId}/households/${householdId}`)
      .set('Authorization', authorization)
      .send({ name: 'Petrosyan family', seatsAllotted: 5 })
      .expect(200);

    expect(body).toEqual({ id: householdId, name: 'Petrosyan family', seatsAllotted: 5, seatsNamed: 1 });
  });

  it('404s a guest that is not on this event', async () => {
    const { eventId, authorization } = await signedIn();

    await http()
      .patch(`/api/v1/events/${eventId}/guests/not-a-guest`)
      .set('Authorization', authorization)
      .send({ firstName: 'X' })
      .expect(404);
  });

  // A designer builds the page; the guest list is not theirs to change.
  it.each([
    ['post', 'guests'],
    ['patch', 'guests/any'],
    ['delete', 'guests/any'],
    ['patch', 'households/any'],
  ] as const)('refuses a designer on %s %s', async (method, path) => {
    const { eventId, authorization } = await signedIn(EventRole.DESIGNER);

    await http()[method](`/api/v1/events/${eventId}/${path}`)
      .set('Authorization', authorization)
      .send({ firstName: 'Ani' })
      .expect(403);
  });
});
