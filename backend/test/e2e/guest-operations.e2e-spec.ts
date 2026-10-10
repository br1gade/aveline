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

    // B27: nothing enforced the 2 MB the docs promise.
    it('refuses a file over 2 MB before reading it', async () => {
      const { eventId, authorization } = await coordinator();
      const big = `First Name\n${'Armen\n'.repeat(400_000)}`;

      await importCsv(eventId, authorization, big).expect(413);
      expect(await prisma.guestImport.count({ where: { eventId } })).toBe(0);
    });

    it('refuses more than 2000 guests, saying so', async () => {
      const { eventId, authorization } = await coordinator();
      const rows = Array.from({ length: 2001 }, (_, index) => `Guest${index}`);

      const { body } = await importCsv(eventId, authorization, ['First Name', ...rows].join('\n')).expect(400);

      expect(body.message).toMatch(/2000/);
    });

    // B27: a re-import without a Side column reset every guest to UNKNOWN.
    it('keeps the sides already set when a re-import has no Side column', async () => {
      const { eventId, authorization } = await coordinator();
      await importCsv(eventId, authorization, CSV).expect(201);

      await importCsv(eventId, authorization, 'First Name,Last Name,Household\nArmen,Petrosyan,Petrosyan family').expect(201);

      const armen = await prisma.guest.findFirstOrThrow({ where: { eventId, firstName: 'Armen' } });
      expect(armen.attribution).toBe('SIDE_A');
    });

    // B27: the import ignored the household's seats, so a family of four
    // could be named into two seats.
    it('reports a row that would overfill a household whose seats the file states', async () => {
      const { eventId, authorization } = await coordinator();
      const csv = ['First Name,Household,Seats', 'Armen,Petrosyan,2', 'Lusine,Petrosyan,2', 'Narek,Petrosyan,2'].join('\n');

      const { body } = await importCsv(eventId, authorization, csv).expect(201);

      expect(body).toMatchObject({ status: 'PARTIAL', rowsImported: 2, rowsFailed: 1 });
      expect(body.errors[0]).toMatchObject({ row: 4, message: expect.stringMatching(/2 seat/) });
      expect(await prisma.guest.count({ where: { eventId, household: { name: 'Petrosyan' } } })).toBe(2);
    });

    it('gives a household as many seats as people named, when the file does not say', async () => {
      const { eventId, authorization } = await coordinator();
      const csv = ['First Name,Household', 'Armen,Petrosyan', 'Lusine,Petrosyan', 'Narek,Petrosyan'].join('\n');

      await importCsv(eventId, authorization, csv).expect(201);
      await importCsv(eventId, authorization, `${csv}\nAni,Petrosyan`).expect(201);

      const household = await prisma.household.findFirstOrThrow({ where: { eventId, name: 'Petrosyan' }, include: { guests: true } });
      expect(household.guests).toHaveLength(4);
      expect(household.seatsAllotted).toBe(4);
    });

    // B65: a mistyped email was kept in the import history, which a viewer
    // reads with guest:read alone, and which erasure never touched.
    it('quotes a bad email back to the importer, but never keeps it in the history', async () => {
      const { eventId, authorization } = await coordinator();

      const { body } = await importCsv(eventId, authorization, 'First Name,Email\nAnna,anna.petrosyan.gmail.com').expect(201);

      expect(body.errors[0]).toMatchObject({ row: 2, value: 'anna.petrosyan.gmail.com' });
      const viewer = await authenticateAs(app, prisma, { eventId, role: EventRole.VIEWER });
      const history = await http().get(`/api/v1/events/${eventId}/guests/imports`).set('Authorization', viewer.authorization).expect(200);
      expect(JSON.stringify(history.body)).not.toContain('petrosyan.gmail');
      expect(JSON.stringify(await prisma.guestImport.findMany())).not.toContain('petrosyan.gmail');
    });

    // B77: a double upload or a retry ran twice at once and duplicated every
    // household and guest — each duplicate then invited.
    it('runs one import of an event at a time, so a double upload adds nobody twice', async () => {
      const { eventId, authorization } = await coordinator();

      const statuses = await Promise.all([1, 2, 3].map(async () => (await importCsv(eventId, authorization, CSV)).status));

      expect(statuses.filter((status) => status === 201).length).toBeGreaterThanOrEqual(1);
      expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
      expect(await prisma.household.count({ where: { eventId, name: 'Petrosyan family' } })).toBe(1);
      expect(await prisma.guest.count({ where: { eventId, firstName: 'Armen' } })).toBe(1);
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

    // B31: a walk-in, or someone who declined and came anyway, was subtracted
    // from those expected — so "still to come" fell for people nobody waited for.
    it('counts only expected guests against those still to come, and walk-ins apart', async () => {
      const { eventId, authorization } = await coordinator();
      await importCsv(eventId, authorization, CSV).expect(201);
      await prisma.rsvp.updateMany({ where: { guest: { eventId } }, data: { status: 'ATTENDING' } });
      await prisma.rsvp.updateMany({ where: { guest: { eventId, firstName: { in: ['Mariam', 'Tigran'] } } }, data: { status: 'DECLINED' } });
      const expected = await prisma.guest.count({ where: { eventId, rsvp: { status: 'ATTENDING' } } });
      const checkIn = async (firstName: string) => {
        const guest = await prisma.guest.findFirstOrThrow({ where: { eventId, firstName } });
        await http().post(`/api/v1/events/${eventId}/guests/${guest.id}/check-in`).set('Authorization', authorization).expect(201);
      };
      await checkIn('Armen');
      await checkIn('Mariam');
      await checkIn('Tigran');

      const { body } = await http().get(`/api/v1/events/${eventId}/arrivals`).set('Authorization', authorization).expect(200);

      expect(body).toMatchObject({ expected, arrived: 3, unexpected: 2, stillToCome: expected - 1 });
    });
  });
});
