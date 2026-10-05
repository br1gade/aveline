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
 * The Managed tier's actual work: get a guest list in, seat it, and run the
 * door on the day. Tested as one flow because that is how it is used — an
 * import that produces households the seater cannot read would pass three
 * separate unit tests and still be useless.
 */
describe('Guest operations (e2e)', () => {
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

  const coordinator = async () => {
    const { eventId } = await seedEvent(prisma);
    const { authorization } = await authenticateAs(app, prisma, {
      eventId,
      role: EventRole.COORDINATOR,
    });
    return { eventId, authorization };
  };

  const CSV = [
    'First Name,Last Name,Household,Seats,Side,Email',
    'Armen,Petrosyan,Petrosyan family,3,A,armen@test.local',
    'Lusine,Petrosyan,Petrosyan family,3,A,',
    'Narek,Petrosyan,Petrosyan family,3,A,',
    'Mariam,Sargsyan,Sargsyan,2,B,mariam@test.local',
    'Tigran,Hakobyan,Hakobyan,1,B,',
  ].join('\n');

  const importCsv = (eventId: string, authorization: string, csv: string) =>
    http()
      .post(`/api/v1/events/${eventId}/guests/import`)
      .set('Authorization', authorization)
      .attach('file', Buffer.from(csv), { filename: 'guests.csv', contentType: 'text/csv' });

  describe('importing a guest list', () => {
    it('creates guests grouped into households', async () => {
      const { eventId, authorization } = await coordinator();

      const { body } = await importCsv(eventId, authorization, CSV).expect(201);

      expect(body).toMatchObject({ status: 'COMPLETED', rowsImported: 5, rowsFailed: 0 });
      const households = await prisma.household.findMany({
        where: { eventId, name: { not: 'Fixture Household' } },
        include: { guests: true },
      });
      expect(households).toHaveLength(3);
      expect(households.find((h) => h.name === 'Petrosyan family')?.guests).toHaveLength(3);
    });

    // The primary guest holds the household's invitation link. Marking all
    // three Petrosyans primary would send the same family three links and
    // make the guest list's ordering meaningless.
    it('makes exactly one guest per household primary', async () => {
      const { eventId, authorization } = await coordinator();
      await importCsv(eventId, authorization, CSV).expect(201);

      const households = await prisma.household.findMany({
        where: { eventId, name: { not: 'Fixture Household' } },
        include: { guests: { select: { isPrimary: true } } },
      });

      expect(households).not.toHaveLength(0);
      for (const household of households) {
        expect(household.guests.filter((guest) => guest.isPrimary)).toHaveLength(1);
      }
    });

    // Failing four hundred good rows over twelve bad ones sends a host back
    // to a spreadsheet.
    it('saves the good rows and reports the bad ones by row number', async () => {
      const { eventId, authorization } = await coordinator();
      const messy = ['name,seats', 'Armen,2', ',3', 'Mariam,notanumber', 'Tigran,1'].join('\n');

      const { body } = await importCsv(eventId, authorization, messy).expect(201);

      expect(body).toMatchObject({ status: 'PARTIAL', rowsImported: 2, rowsFailed: 2 });
      const { errors } = body as { errors: { row: number }[] };
      expect(errors.map((error) => error.row)).toEqual([3, 4]);
    });

    it('reuses households on a re-import rather than duplicating them', async () => {
      const { eventId, authorization } = await coordinator();

      await importCsv(eventId, authorization, CSV).expect(201);
      await importCsv(eventId, authorization, CSV).expect(201);

      const households = await prisma.household.count({
        where: { eventId, name: 'Petrosyan family' },
      });
      expect(households).toBe(1);
      expect(await prisma.guest.count({ where: { eventId, household: { name: 'Petrosyan family' } } })).toBe(3);
    });

    it('records the import so a host can see what happened', async () => {
      const { eventId, authorization } = await coordinator();
      await importCsv(eventId, authorization, CSV).expect(201);

      const { body } = await http()
        .get(`/api/v1/events/${eventId}/guests/imports`)
        .set('Authorization', authorization)
        .expect(200);

      expect(body[0]).toMatchObject({ filename: 'guests.csv', rowsImported: 5 });
    });

    it('refuses an import without guest:write', async () => {
      const { eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      await importCsv(eventId, authorization, CSV).expect(403);
    });
  });

  describe('tables and seating', () => {
    const readyToSeat = async () => {
      const { eventId, authorization } = await coordinator();
      await importCsv(eventId, authorization, CSV).expect(201);
      await prisma.rsvp.updateMany({
        where: { guest: { eventId } },
        data: { status: 'ATTENDING' },
      });
      return { eventId, authorization };
    };

    it('creates tables in bulk', async () => {
      const { eventId, authorization } = await coordinator();

      const { body } = await http()
        .post(`/api/v1/events/${eventId}/tables/bulk`)
        .set('Authorization', authorization)
        .send({ namePrefix: 'Table', count: 4, capacity: 8 })
        .expect(201);

      expect(body).toEqual({ created: 4 });
    });

    it('seats everyone attending, keeping households together', async () => {
      const { eventId, authorization } = await readyToSeat();
      await http()
        .post(`/api/v1/events/${eventId}/tables/bulk`)
        .set('Authorization', authorization)
        .send({ namePrefix: 'Table', count: 2, capacity: 6 })
        .expect(201);

      const { body } = await http()
        .post(`/api/v1/events/${eventId}/seats/auto-assign`)
        .set('Authorization', authorization)
        .expect(201);

      expect(body.unseated).toHaveLength(0);

      const tables = await http()
        .get(`/api/v1/events/${eventId}/tables`)
        .set('Authorization', authorization)
        .expect(200);

      // The Petrosyans must all be at one table.
      const petrosyans = await prisma.guest.findMany({
        where: { eventId, household: { name: 'Petrosyan family' } },
        include: { seat: true },
      });
      expect(new Set(petrosyans.map((g) => g.seat?.tableId)).size).toBe(1);
      const seatedTables = tables.body as { seated: number; capacity: number }[];
      expect(seatedTables.every((table) => table.seated <= table.capacity)).toBe(true);
    });

    it('reports who could not be seated, with a reason', async () => {
      const { eventId, authorization } = await readyToSeat();
      await http()
        .post(`/api/v1/events/${eventId}/tables`)
        .set('Authorization', authorization)
        .send({ name: 'Only table', capacity: 2 })
        .expect(201);

      const { body } = await http()
        .post(`/api/v1/events/${eventId}/seats/auto-assign`)
        .set('Authorization', authorization)
        .expect(201);

      expect(body.unseated.length).toBeGreaterThan(0);
      expect(body.unseated[0].reason).toEqual(expect.any(String));
    });

    it('refuses to seat someone at a full table', async () => {
      const { eventId, authorization } = await readyToSeat();
      const { body: table } = await http()
        .post(`/api/v1/events/${eventId}/tables`)
        .set('Authorization', authorization)
        .send({ name: 'Small', capacity: 1 })
        .expect(201);
      const guests = await prisma.guest.findMany({ where: { eventId }, take: 2 });

      await http()
        .post(`/api/v1/events/${eventId}/seats`)
        .set('Authorization', authorization)
        .send({ guestId: guests[0].id, tableId: table.id })
        .expect(201);

      await http()
        .post(`/api/v1/events/${eventId}/seats`)
        .set('Authorization', authorization)
        .send({ guestId: guests[1].id, tableId: table.id })
        .expect(409);
    });

    it('refuses to delete a table with guests at it', async () => {
      const { eventId, authorization } = await readyToSeat();
      const { body: table } = await http()
        .post(`/api/v1/events/${eventId}/tables`)
        .set('Authorization', authorization)
        .send({ name: 'Occupied', capacity: 8 })
        .expect(201);
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId } });
      await http()
        .post(`/api/v1/events/${eventId}/seats`)
        .set('Authorization', authorization)
        .send({ guestId: guest.id, tableId: table.id })
        .expect(201);

      await http()
        .delete(`/api/v1/events/${eventId}/tables/${table.id}`)
        .set('Authorization', authorization)
        .expect(409);
    });

    it('lets a guest find their own seat without a token', async () => {
      const { eventId, authorization } = await readyToSeat();
      await http()
        .post(`/api/v1/events/${eventId}/tables/bulk`)
        .set('Authorization', authorization)
        .send({ namePrefix: 'Table', count: 2, capacity: 6 })
        .expect(201);
      await http()
        .post(`/api/v1/events/${eventId}/seats/auto-assign`)
        .set('Authorization', authorization)
        .expect(201);

      const { body } = await http()
        .get(`/api/v1/events/${eventId}/find-seat`)
        .query({ q: 'Armen' })
        .expect(200);

      expect(body[0].table).toEqual(expect.any(String));
    });
  });

  describe('check-in on the day', () => {
    it('records an arrival and says where to send them', async () => {
      const { eventId, authorization } = await coordinator();
      await importCsv(eventId, authorization, CSV).expect(201);
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId, firstName: 'Armen' } });

      const { body } = await http()
        .post(`/api/v1/events/${eventId}/guests/${guest.id}/check-in`)
        .set('Authorization', authorization)
        .expect(201);

      expect(body).toMatchObject({ name: 'Armen Petrosyan' });
      expect(body.arrivedAt).toEqual(expect.any(String));
    });

    // Two people on the door must not both record the same arrival.
    it('refuses a second check-in for the same guest', async () => {
      const { eventId, authorization } = await coordinator();
      await importCsv(eventId, authorization, CSV).expect(201);
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId, firstName: 'Armen' } });
      const url = `/api/v1/events/${eventId}/guests/${guest.id}/check-in`;

      await http().post(url).set('Authorization', authorization).expect(201);
      await http().post(url).set('Authorization', authorization).expect(409);
    });

    it('undoes a mis-scan', async () => {
      const { eventId, authorization } = await coordinator();
      await importCsv(eventId, authorization, CSV).expect(201);
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId, firstName: 'Armen' } });
      const url = `/api/v1/events/${eventId}/guests/${guest.id}/check-in`;

      await http().post(url).set('Authorization', authorization).expect(201);
      await http().delete(url).set('Authorization', authorization).expect(200);
      await http().post(url).set('Authorization', authorization).expect(201);
    });

    it('reports live arrivals against who was expected', async () => {
      const { eventId, authorization } = await coordinator();
      await importCsv(eventId, authorization, CSV).expect(201);
      await prisma.rsvp.updateMany({ where: { guest: { eventId } }, data: { status: 'ATTENDING' } });
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId, firstName: 'Armen' } });
      await http()
        .post(`/api/v1/events/${eventId}/guests/${guest.id}/check-in`)
        .set('Authorization', authorization)
        .expect(201);

      const { body } = await http()
        .get(`/api/v1/events/${eventId}/arrivals`)
        .set('Authorization', authorization)
        .expect(200);

      expect(body).toMatchObject({ arrived: 1 });
      expect(body.expected).toBeGreaterThanOrEqual(1);
      expect(body.recent[0].name).toBe('Armen Petrosyan');
    });
  });
});
