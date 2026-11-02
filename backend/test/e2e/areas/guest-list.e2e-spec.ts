import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, MessageChannel, OrganizationRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The guest list over HTTP, where earlier specs stopped short: re-imports
 * that correct rather than replace, an import run left behind by a crash, who
 * reads one guest's contact details, removals that reach the seating plan
 * and the headcount, and who may read or change the suppression list.
 * Edits addressed to another event are proven in the integration spec.
 */
describe('Guest list (e2e)', () => {
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

  const signedIn = async (role: EventRole = EventRole.COORDINATOR, seatsAllotted = 2) => {
    const seeded = await seedEvent(prisma, { seatsAllotted });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    return { ...seeded, authorization };
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

  describe('re-importing a corrected file', () => {
    const corrected = 'First Name,Last Name,Household,Email\nArmen,Petrosyan,Petrosyan family,armen.new@example.am';

    it('updates the matched guest in place, keeping their id', async () => {
      const { eventId, authorization } = await signedIn();
      await importCsv(eventId, authorization, CSV).expect(201);
      const before = await prisma.guest.findFirstOrThrow({ where: { eventId, firstName: 'Armen' } });

      const { body } = await importCsv(eventId, authorization, corrected).expect(201);

      expect(body).toMatchObject({ status: 'COMPLETED', rowsImported: 1, rowsFailed: 0 });
      const armen = await prisma.guest.findMany({ where: { eventId, firstName: 'Armen' } });
      expect(armen).toEqual([expect.objectContaining({ id: before.id, email: 'armen.new@example.am', token: before.token })]);
    });

    it('keeps every guest the corrected file leaves out', async () => {
      const { eventId, authorization } = await signedIn();
      await importCsv(eventId, authorization, CSV).expect(201);
      const before = await prisma.guest.count({ where: { eventId } });

      await importCsv(eventId, authorization, corrected).expect(201);

      expect(await prisma.guest.count({ where: { eventId } })).toBe(before);
      const names = await prisma.guest.findMany({ where: { eventId, household: { name: { not: 'Fixture Household' } } }, select: { firstName: true } });
      expect(names.map((guest) => guest.firstName).sort()).toEqual(['Armen', 'Lusine', 'Mariam', 'Narek', 'Tigran']);
    });
  });

  describe('an import run left PROCESSING', () => {
    const leftRunning = (eventId: string, minutesAgo: number) =>
      prisma.guestImport.create({
        data: { eventId, filename: 'crashed.csv', rowsTotal: 1, status: 'PROCESSING', createdAt: new Date(Date.now() - minutesAgo * 60_000) },
      });

    it('is closed as FAILED after ten minutes so a new import can run', async () => {
      const { eventId, authorization } = await signedIn();
      const crashed = await leftRunning(eventId, 11);

      const { body } = await importCsv(eventId, authorization, CSV).expect(201);

      expect(body).toMatchObject({ status: 'COMPLETED', rowsImported: 5 });
      const closed = await prisma.guestImport.findUniqueOrThrow({ where: { id: crashed.id } });
      expect(closed.status).toBe('FAILED');
      expect(closed.finishedAt).toBeInstanceOf(Date);
    });

    it('still blocks a new import when it started a minute ago', async () => {
      const { eventId, authorization } = await signedIn();
      const running = await leftRunning(eventId, 1);

      const { body } = await importCsv(eventId, authorization, CSV).expect(409);

      expect(body.message).toMatch(/already running/);
      expect(await prisma.guestImport.findUniqueOrThrow({ where: { id: running.id } })).toMatchObject({ status: 'PROCESSING', finishedAt: null });
      expect(await prisma.guest.count({ where: { eventId, firstName: 'Armen' } })).toBe(0);
    });
  });

  describe("reading one guest's details", () => {
    const withAni = async (role: EventRole) => {
      const seeded = await signedIn(role);
      const ani = await prisma.guest.create({
        data: {
          eventId: seeded.eventId, householdId: seeded.householdId, firstName: 'Ani',
          email: 'ani@example.am', phone: '+374 91 000000', token: `ani-${seeded.slug}`, rsvp: { create: {} },
        },
      });
      return { ...seeded, aniId: ani.id };
    };

    it('leaves out email, phone and personal link for a viewer', async () => {
      const { eventId, authorization, aniId } = await withAni(EventRole.VIEWER);

      const { body } = await http().get(`/api/v1/events/${eventId}/guests/${aniId}`).set('Authorization', authorization).expect(200);

      expect(body).toMatchObject({ id: aniId, firstName: 'Ani' });
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('phone');
      expect(body).not.toHaveProperty('token');
    });

    it('refuses a designer, who holds no guest:read', async () => {
      const { eventId, authorization, aniId } = await withAni(EventRole.DESIGNER);

      await http().get(`/api/v1/events/${eventId}/guests/${aniId}`).set('Authorization', authorization).expect(403);
    });
  });

  describe('removing a seated, attending guest', () => {
    const attendingPair = async () => {
      const seeded = await signedIn(EventRole.COORDINATOR, 3);
      const as = (path: string) => `/api/v1/events/${seeded.eventId}/${path}`;
      const primary = await prisma.guest.findUniqueOrThrow({ where: { token: seeded.primaryGuestToken } });
      const { body: ani } = await http().post(as('guests')).set('Authorization', seeded.authorization)
        .send({ firstName: 'Ani', householdId: seeded.householdId }).expect(201);
      for (const guestId of [primary.id, ani.id as string]) {
        await http().patch(as(`guests/${guestId}/rsvp`)).set('Authorization', seeded.authorization)
          .send({ status: 'ATTENDING', dietary: ['vegetarian'] }).expect(200);
      }
      const { body: table } = await http().post(as('tables')).set('Authorization', seeded.authorization)
        .send({ name: 'Table 1', capacity: 10 }).expect(201);
      for (const guestId of [primary.id, ani.id as string]) {
        await http().post(as('seats')).set('Authorization', seeded.authorization).send({ guestId, tableId: table.id }).expect(201);
      }
      const read = async <T>(path: string): Promise<T> => (await http().get(as(path)).set('Authorization', seeded.authorization).expect(200)).body as T;
      return { ...seeded, as, read, primaryId: primary.id, aniId: ani.id as string, tableId: table.id as string };
    };

    const tableSeated = async (read: <T>(path: string) => Promise<T>, tableId: string) =>
      (await read<{ id: string; seated: number }[]>('tables')).find((table) => table.id === tableId)?.seated;

    it('frees their seat on the plan', async () => {
      const { as, authorization, read, aniId, tableId } = await attendingPair();
      expect(await tableSeated(read, tableId)).toBe(2);

      await http().delete(as(`guests/${aniId}`)).set('Authorization', authorization).expect(200);

      expect(await prisma.seat.count({ where: { guestId: aniId } })).toBe(0);
      expect(await tableSeated(read, tableId)).toBe(1);
    });

    it('stops the headcount and catering sheet counting them', async () => {
      const { as, authorization, read, aniId } = await attendingPair();
      const before = { headcount: await read<{ attending: number; invited: number }>('headcount'), catering: await read('catering-sheet') };
      expect(before.headcount.attending).toBe(2);
      expect(before.catering).toMatchObject({ covers: 2, requirements: [expect.objectContaining({ key: 'vegetarian', count: 2 })] });

      await http().delete(as(`guests/${aniId}`)).set('Authorization', authorization).expect(200);

      expect(await read('headcount')).toMatchObject({ attending: 1, invited: before.headcount.invited - 1 });
      expect(await read('catering-sheet')).toMatchObject({ covers: 1, requirements: [expect.objectContaining({ key: 'vegetarian', count: 1 })] });
    });

    it('hands the household to the remaining guest when the primary is removed', async () => {
      const { as, authorization, primaryId, aniId, householdId } = await attendingPair();

      const { body } = await http().delete(as(`guests/${primaryId}`)).set('Authorization', authorization).expect(200);

      expect(body).toEqual({ removed: primaryId, isHouseholdRemoved: false });
      expect(await prisma.guest.findMany({ where: { householdId }, select: { id: true, isPrimary: true } })).toEqual([{ id: aniId, isPrimary: true }]);
    });
  });

  describe('who may use the suppression list', () => {
    const memberOf = async (organizationId: string, role: OrganizationRole) => {
      const { authorization, userId } = await authenticateAs(app, prisma);
      await prisma.organizationMembership.create({ data: { userId, organizationId, role } });
      return authorization;
    };

    const organizationWithSuppression = async () => {
      const { eventId } = await seedEvent(prisma);
      const { organizationId } = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      const row = await prisma.suppression.create({
        data: { organizationId, channel: MessageChannel.EMAIL, address: 'ani@test.local', reason: 'MANUAL' },
      });
      return { organizationId, row };
    };

    it.each([OrganizationRole.VIEWER, OrganizationRole.MEMBER])('refuses an organization %s the list', async (role) => {
      const { organizationId } = await organizationWithSuppression();
      const authorization = await memberOf(organizationId, role);

      const { body } = await http().get('/api/v1/suppressions').set('Authorization', authorization).expect(403);

      expect(body.message).toMatch(/may not guest:contact:read/);
    });

    it('lets an organization MANAGER read the list', async () => {
      const { organizationId, row } = await organizationWithSuppression();
      const authorization = await memberOf(organizationId, OrganizationRole.MANAGER);

      const { body } = await http().get('/api/v1/suppressions').set('Authorization', authorization).expect(200);

      expect(body).toEqual([expect.objectContaining({ id: row.id, address: 'ani@test.local' })]);
    });

    it.each([OrganizationRole.VIEWER, OrganizationRole.MEMBER])('refuses an organization %s adding or lifting one', async (role) => {
      const { organizationId, row } = await organizationWithSuppression();
      const authorization = await memberOf(organizationId, role);

      const added = await http().post('/api/v1/suppressions').set('Authorization', authorization)
        .send({ channel: MessageChannel.EMAIL, address: 'new@test.local' }).expect(403);
      const lifted = await http().delete(`/api/v1/suppressions/${row.id}`).set('Authorization', authorization).expect(403);

      expect([added.body.message, lifted.body.message]).toEqual([expect.stringMatching(/may not guest:write/), expect.stringMatching(/may not guest:write/)]);
      const rows = await prisma.suppression.findMany({ where: { organizationId }, select: { id: true } });
      expect(rows).toEqual([{ id: row.id }]);
    });

    it('lets an organization MANAGER add one and lift another', async () => {
      const { organizationId, row } = await organizationWithSuppression();
      const authorization = await memberOf(organizationId, OrganizationRole.MANAGER);

      await http().post('/api/v1/suppressions').set('Authorization', authorization)
        .send({ channel: MessageChannel.EMAIL, address: 'new@test.local' }).expect(201);
      await http().delete(`/api/v1/suppressions/${row.id}`).set('Authorization', authorization).expect(200);

      const rows = await prisma.suppression.findMany({ where: { organizationId }, select: { address: true } });
      expect(rows).toEqual([{ address: 'new@test.local' }]);
    });
  });
});
