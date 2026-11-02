import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DataSubjectRequestKind,
  DataSubjectRequestStatus,
  EventRole,
  OrganizationRole,
  PlatformRole,
  PrismaClient,
  RsvpStatus,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { DAY_MS } from '../../fixtures/areas/privacy.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const SUBJECT = 'primary@test.local';
const RESPONSE_WINDOW_MS = 30 * DAY_MS;

describe('Data-subject requests (e2e coverage)', () => {
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

  const submit = (kind: DataSubjectRequestKind, subjectEmail: string, notes?: string) =>
    http().post('/api/v1/privacy/requests').send({ kind, subjectEmail, notes }).expect(201);

  /** Aveline's own data-protection staff: a platform ADMIN. */
  const privacyOfficer = async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: userId }, data: { platformRole: PlatformRole.ADMIN } });
    return authorization;
  };

  describe('submitting a request', () => {
    it.each([DataSubjectRequestStatus.COMPLETED, DataSubjectRequestStatus.REJECTED])(
      'opens a new request with its own clock once the earlier one is %s',
      async (closed) => {
        await submit(DataSubjectRequestKind.ERASURE, 'ani@test.local', 'first');
        const earlier = await prisma.dataSubjectRequest.findFirstOrThrow();
        await prisma.dataSubjectRequest.update({ where: { id: earlier.id }, data: { status: closed, completedAt: new Date() } });

        const before = Date.now();
        await submit(DataSubjectRequestKind.ERASURE, 'ani@test.local', 'second');
        const after = Date.now();

        expect(await prisma.dataSubjectRequest.count()).toBe(2);
        const fresh = await prisma.dataSubjectRequest.findFirstOrThrow({ where: { id: { not: earlier.id } } });
        expect(fresh).toMatchObject({ status: DataSubjectRequestStatus.RECEIVED, notes: 'second' });
        expect(fresh.dueAt.getTime()).toBeGreaterThanOrEqual(before + RESPONSE_WINDOW_MS);
        expect(fresh.dueAt.getTime()).toBeLessThanOrEqual(after + RESPONSE_WINDOW_MS);
        expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: earlier.id } })).notes).toBe('first');
      },
    );

    // docs/API.md: "dueAt is one month out, per Article 12".
    it('sets the deadline thirty days from receipt, in the answer and on the stored request', async () => {
      const before = Date.now();
      const { body } = await submit(DataSubjectRequestKind.EXPORT, 'ani@test.local');
      const after = Date.now();

      const answered = new Date(body.dueAt as string).getTime();
      expect(answered).toBeGreaterThanOrEqual(before + RESPONSE_WINDOW_MS);
      expect(answered).toBeLessThanOrEqual(after + RESPONSE_WINDOW_MS);
      const stored = await prisma.dataSubjectRequest.findFirstOrThrow();
      expect(stored.dueAt.getTime()).toBe(answered);
    });
  });

  describe('the staff queue', () => {
    const requestDue = (status: DataSubjectRequestStatus, inDays: number, subjectEmail: string) =>
      prisma.dataSubjectRequest.create({
        data: { kind: DataSubjectRequestKind.ERASURE, status, subjectEmail, dueAt: new Date(Date.now() + inDays * DAY_MS) },
      });

    it('lists one status soonest due first', async () => {
      const officer = await privacyOfficer();
      await requestDue(DataSubjectRequestStatus.RECEIVED, 20, 'twenty@test.local');
      await requestDue(DataSubjectRequestStatus.RECEIVED, 2, 'two@test.local');
      await requestDue(DataSubjectRequestStatus.RECEIVED, 10, 'ten@test.local');
      await requestDue(DataSubjectRequestStatus.IN_PROGRESS, 1, 'working@test.local');

      const { body } = await http().get('/api/v1/privacy/requests?status=RECEIVED').set('Authorization', officer).expect(200);

      expect((body as { subjectEmail: string }[]).map((row) => row.subjectEmail)).toEqual(['two@test.local', 'ten@test.local', 'twenty@test.local']);
    });

    it('lists every status without a filter', async () => {
      const officer = await privacyOfficer();
      await requestDue(DataSubjectRequestStatus.RECEIVED, 2, 'two@test.local');
      await requestDue(DataSubjectRequestStatus.IN_PROGRESS, 1, 'working@test.local');

      const { body } = await http().get('/api/v1/privacy/requests').set('Authorization', officer).expect(200);

      expect((body as { subjectEmail: string }[]).map((row) => row.subjectEmail).sort()).toEqual(['two@test.local', 'working@test.local']);
    });

    it('rejects a status that does not exist, naming the field', async () => {
      const officer = await privacyOfficer();

      const { body } = await http().get('/api/v1/privacy/requests?status=LOST').set('Authorization', officer).expect(400);

      expect(body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'status' })]));
    });
  });

  describe('an erasure, carried out', () => {
    /** The seeded guest, attending, vegan and seated, at an event a host owns. */
    const seatedVeganGuest = async () => {
      const { eventId } = await seedEvent(prisma);
      const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      const host = await authenticateAs(app, prisma, { eventId, role: EventRole.OWNER });
      await prisma.organizationMembership.create({ data: { userId: host.userId, organizationId: event.organizationId, role: OrganizationRole.OWNER } });
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId } });
      await prisma.guest.update({ where: { id: guest.id }, data: { email: SUBJECT } });
      await prisma.rsvp.update({ where: { guestId: guest.id }, data: { status: RsvpStatus.ATTENDING, dietary: ['vegan'], respondedAt: new Date() } });
      const table = await prisma.table.create({ data: { eventId, name: 'Table 1', capacity: 8 } });
      const seat = await prisma.seat.create({ data: { guestId: guest.id, tableId: table.id, position: 1 } });
      return { eventId, guestId: guest.id, host: host.authorization, seat };
    };

    const eraseOverHttp = async (subjectEmail = SUBJECT) => {
      const officer = await privacyOfficer();
      await submit(DataSubjectRequestKind.ERASURE, subjectEmail);
      const { id } = await prisma.dataSubjectRequest.findFirstOrThrow({ where: { subjectEmail } });
      await http().patch(`/api/v1/privacy/requests/${id}`).set('Authorization', officer).send({ status: DataSubjectRequestStatus.IN_PROGRESS }).expect(200);
      return http().post(`/api/v1/privacy/requests/${id}/fulfil`).set('Authorization', officer).expect(201);
    };

    const exportCsv = async (eventId: string, authorization: string, kind: string) => {
      const { body } = await http().post(`/api/v1/events/${eventId}/exports`).set('Authorization', authorization).send({ kind }).expect(201);
      return (await http().get(body.downloadPath as string).set('Authorization', authorization).expect(200)).text;
    };

    /** The count the catering sheet gives for one requirement, or 0 when absent. */
    const requirementCount = (csv: string, requirement: string) => {
      const line = csv.split(/\r?\n/).find((row) => row.replace(/"/g, '').toLowerCase().startsWith(`${requirement.toLowerCase()},`));
      return line ? Number(line.replace(/"/g, '').split(',')[1]) : 0;
    };

    // Household and response are covered in privacy-and-exports.e2e-spec.ts; the seat was not.
    it('keeps their seat at the table they were placed at', async () => {
      const { guestId, seat } = await seatedVeganGuest();

      await eraseOverHttp();

      const guest = await prisma.guest.findUniqueOrThrow({ where: { id: guestId }, include: { seats: true } });
      expect(guest.firstName).toBe('Removed');
      expect(guest.seats).toEqual([expect.objectContaining({ id: seat.id, tableId: seat.tableId, position: 1 })]);
    });

    it('drops their requirement from the catering sheet and keeps the covers', async () => {
      const { eventId, host } = await seatedVeganGuest();
      const before = await exportCsv(eventId, host, 'CATERING_SHEET');
      expect(requirementCount(before, 'vegan')).toBe(1);

      await eraseOverHttp();

      const after = await exportCsv(eventId, host, 'CATERING_SHEET');
      expect(requirementCount(after, 'vegan')).toBe(0);
      expect(requirementCount(after, 'Total covers')).toBe(requirementCount(before, 'Total covers'));
      expect(requirementCount(after, 'Total covers')).toBeGreaterThan(0);
    });
  });
});
