import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DataSubjectRequestKind,
  DataSubjectRequestStatus,
  EventRole,
  MessageChannel,
  OrganizationRole,
  PrismaClient,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Privacy and exports (e2e)', () => {
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

  /** An account that owns the seeded event's organization, so it holds
   *  privacy:manage as well as the operational permissions. */
  const dataProtectionOfficer = async () => {
    const { eventId } = await seedEvent(prisma);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const { authorization, userId } = await authenticateAs(app, prisma, {
      eventId,
      role: EventRole.OWNER,
    });
    // The fixture guest has no contact details; erasure and export both need
    // an address to match on.
    await prisma.guest.updateMany({
      where: { eventId },
      data: { email: 'primary@test.local', phone: '+37410000000' },
    });
    await prisma.organizationMembership.create({
      data: {
        userId,
        organizationId: event.organizationId,
        role: OrganizationRole.OWNER,
      },
    });
    return { eventId, organizationId: event.organizationId, authorization };
  };

  describe('submitting a request', () => {
    it('needs no account', async () => {
      const { body } = await http()
        .post('/api/v1/privacy/requests')
        .send({ kind: DataSubjectRequestKind.EXPORT, subjectEmail: 'ani@test.local' })
        .expect(201);

      expect(body).toMatchObject({ kind: 'EXPORT', status: 'RECEIVED' });
      expect(body.reference).toEqual(expect.any(String));
      const { dueAt } = body as { dueAt: string };
      expect(new Date(dueAt).getTime()).toBeGreaterThan(Date.now());
    });

    /**
     * "We hold nothing about you" is itself information about that address,
     * and anyone can type any address into this form.
     */
    it('answers identically whether or not anything is held', async () => {
      const known = await http()
        .post('/api/v1/privacy/requests')
        .send({ kind: DataSubjectRequestKind.EXPORT, subjectEmail: 'primary@test.local' })
        .expect(201);
      const unknown = await http()
        .post('/api/v1/privacy/requests')
        .send({ kind: DataSubjectRequestKind.EXPORT, subjectEmail: 'nobody@test.local' })
        .expect(201);

      const knownBody = known.body as Record<string, unknown>;
      const unknownBody = unknown.body as Record<string, unknown>;
      expect(knownBody.message).toBe(unknownBody.message);
      expect(Object.keys(knownBody).sort()).toEqual(Object.keys(unknownBody).sort());
    });

    // Twenty copies of one request is twenty clocks to answer.
    it('returns the open request rather than duplicating it', async () => {
      const first = await http()
        .post('/api/v1/privacy/requests')
        .send({ kind: DataSubjectRequestKind.ERASURE, subjectEmail: 'ani@test.local' })
        .expect(201);
      const second = await http()
        .post('/api/v1/privacy/requests')
        .send({ kind: DataSubjectRequestKind.ERASURE, subjectEmail: 'ANI@test.local' })
        .expect(201);

      expect(second.body.reference).toBe(first.body.reference);
      expect(await prisma.dataSubjectRequest.count()).toBe(1);
    });

    it('rejects an address that is not one', async () => {
      await http()
        .post('/api/v1/privacy/requests')
        .send({ kind: DataSubjectRequestKind.EXPORT, subjectEmail: 'not-an-address' })
        .expect(400);
    });
  });

  describe('handling a request', () => {
    const verifiedRequest = async (kind: DataSubjectRequestKind, subjectEmail: string) => {
      const officer = await dataProtectionOfficer();
      const { body } = await http()
        .post('/api/v1/privacy/requests')
        .send({ kind, subjectEmail })
        .expect(201);
      await http()
        .patch(`/api/v1/privacy/requests/${body.reference}`)
        .set('Authorization', officer.authorization)
        .send({ status: DataSubjectRequestStatus.IN_PROGRESS })
        .expect(200);
      return { ...officer, reference: body.reference as string };
    };

    /**
     * Acting on an unverified request would let anyone erase a stranger's data
     * by typing their address into a public form.
     */
    it('refuses to act before the requester is verified', async () => {
      const officer = await dataProtectionOfficer();
      const { body } = await http()
        .post('/api/v1/privacy/requests')
        .send({ kind: DataSubjectRequestKind.ERASURE, subjectEmail: 'primary@test.local' })
        .expect(201);

      const refusal = await http()
        .post(`/api/v1/privacy/requests/${body.reference}/fulfil`)
        .set('Authorization', officer.authorization)
        .expect(400);

      expect(refusal.body.message).toMatch(/IN_PROGRESS/);
    });

    it('assembles an export of what is held', async () => {
      const { authorization, reference } = await verifiedRequest(
        DataSubjectRequestKind.EXPORT,
        'primary@test.local',
      );

      const { body } = await http()
        .post(`/api/v1/privacy/requests/${reference}/fulfil`)
        .set('Authorization', authorization)
        .expect(201);

      expect(body.subjectEmail).toBe('primary@test.local');
      expect(body.guestRecords).toHaveLength(1);
      expect(body.guestRecords[0]).toMatchObject({ email: 'primary@test.local' });
    });

    describe('erasure', () => {
      it('clears the identifying fields and revokes the invitation link', async () => {
        const { authorization, reference } = await verifiedRequest(
          DataSubjectRequestKind.ERASURE,
          'primary@test.local',
        );
        const before = await prisma.guest.findFirstOrThrow({
          where: { email: 'primary@test.local' },
        });

        const { body } = await http()
          .post(`/api/v1/privacy/requests/${reference}/fulfil`)
          .set('Authorization', authorization)
          .expect(201);

        expect(body.guestsAnonymised).toBe(1);
        const after = await prisma.guest.findUniqueOrThrow({ where: { id: before.id } });
        expect(after.email).toBeNull();
        expect(after.phone).toBeNull();
        expect(after.lastName).toBeNull();
        expect(after.firstName).toBe('Removed');
        expect(after.token).not.toBe(before.token);
        expect(after.anonymizedAt).not.toBeNull();
      });

      /**
       * The counterpart: a headcount the caterer was already paid for must not
       * change because someone exercised their rights.
       */
      it('leaves the household, the seat and the response intact', async () => {
        const { authorization, reference } = await verifiedRequest(
          DataSubjectRequestKind.ERASURE,
          'primary@test.local',
        );
        const before = await prisma.guest.findFirstOrThrow({
          where: { email: 'primary@test.local' },
          include: { rsvp: true },
        });

        await http()
          .post(`/api/v1/privacy/requests/${reference}/fulfil`)
          .set('Authorization', authorization)
          .expect(201);

        const after = await prisma.guest.findUniqueOrThrow({
          where: { id: before.id },
          include: { rsvp: true },
        });
        expect(after.householdId).toBe(before.householdId);
        expect(after.rsvp?.status).toBe(before.rsvp?.status);
      });

      it('marks the request completed', async () => {
        const { authorization, reference } = await verifiedRequest(
          DataSubjectRequestKind.ERASURE,
          'primary@test.local',
        );

        await http()
          .post(`/api/v1/privacy/requests/${reference}/fulfil`)
          .set('Authorization', authorization)
          .expect(201);

        const row = await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: reference } });
        expect(row.status).toBe(DataSubjectRequestStatus.COMPLETED);
        expect(row.completedAt).not.toBeNull();
      });

      // A rectification is applied by hand; the erasure branch must not run.
      it('refuses a rectification without erasing anything', async () => {
        const { authorization, reference } = await verifiedRequest(
          DataSubjectRequestKind.RECTIFICATION,
          'primary@test.local',
        );

        await http()
          .post(`/api/v1/privacy/requests/${reference}/fulfil`)
          .set('Authorization', authorization)
          .expect(400);

        const guest = await prisma.guest.findFirstOrThrow({
          where: { email: 'primary@test.local' },
        });
        expect(guest.anonymizedAt).toBeNull();
      });
    });

    it('refuses a coordinator who has no privacy permission', async () => {
      const { eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.COORDINATOR,
      });

      await http().get('/api/v1/privacy/requests').set('Authorization', authorization).expect(403);
    });
  });

  describe('suppressions', () => {
    it('stops contacting an address, idempotently', async () => {
      const { authorization } = await dataProtectionOfficer();
      const body = { channel: MessageChannel.EMAIL, address: 'Ani@Test.local' };

      await http().post('/api/v1/suppressions').set('Authorization', authorization).send(body).expect(201);
      await http().post('/api/v1/suppressions').set('Authorization', authorization).send(body).expect(201);

      const { body: list } = await http()
        .get('/api/v1/suppressions')
        .set('Authorization', authorization)
        .expect(200);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ address: 'ani@test.local', scope: 'ORGANIZATION' });
    });

    it('resumes contacting one of its own', async () => {
      const { authorization } = await dataProtectionOfficer();
      const { body: created } = await http()
        .post('/api/v1/suppressions')
        .set('Authorization', authorization)
        .send({ channel: MessageChannel.EMAIL, address: 'ani@test.local' })
        .expect(201);

      await http()
        .delete(`/api/v1/suppressions/${created.id}`)
        .set('Authorization', authorization)
        .expect(200);

      const { body: list } = await http()
        .get('/api/v1/suppressions')
        .set('Authorization', authorization)
        .expect(200);
      expect(list).toHaveLength(0);
    });

    it('cannot lift a platform-wide suppression', async () => {
      const { authorization } = await dataProtectionOfficer();
      const global = await prisma.suppression.create({
        data: {
          organizationId: null,
          channel: MessageChannel.EMAIL,
          address: 'dead@test.local',
          reason: 'HARD_BOUNCE',
        },
      });

      const { body } = await http()
        .delete(`/api/v1/suppressions/${global.id}`)
        .set('Authorization', authorization)
        .expect(409);

      expect(body.message).toMatch(/platform-wide/);
    });
  });

  describe('exports', () => {
    it('generates a guest list as CSV and returns its URL', async () => {
      const { eventId, authorization } = await dataProtectionOfficer();

      const { body } = await http()
        .post(`/api/v1/events/${eventId}/exports`)
        .set('Authorization', authorization)
        .send({ kind: 'GUEST_LIST' })
        .expect(201);

      expect(body).toMatchObject({ kind: 'GUEST_LIST', format: 'CSV', status: 'COMPLETED' });
      expect(body.asset.url).toEqual(expect.any(String));
      expect(body.asset.sizeBytes).toBeGreaterThan(0);
    });

    it.each([
      'SEATING_CHART',
      'PLACE_CARDS',
      'CATERING_SHEET',
      'BAR_SHEET',
      'PLAYLIST',
      'TICKET_MANIFEST',
    ])('generates a %s', async (kind) => {
      const { eventId, authorization } = await dataProtectionOfficer();

      const { body } = await http()
        .post(`/api/v1/events/${eventId}/exports`)
        .set('Authorization', authorization)
        .send({ kind })
        .expect(201);

      expect(body.status).toBe('COMPLETED');
    });

    // Honest refusal beats a queued job that never runs.
    it.each(['PDF', 'XLSX'])('refuses %s with a 400 saying CSV works', async (format) => {
      const { eventId, authorization } = await dataProtectionOfficer();

      const { body } = await http()
        .post(`/api/v1/events/${eventId}/exports`)
        .set('Authorization', authorization)
        .send({ kind: 'GUEST_LIST', format })
        .expect(400);

      expect(body.message).toMatch(/CSV/);
    });

    it('lists what has been generated', async () => {
      const { eventId, authorization } = await dataProtectionOfficer();
      await http()
        .post(`/api/v1/events/${eventId}/exports`)
        .set('Authorization', authorization)
        .send({ kind: 'GUEST_LIST' })
        .expect(201);

      const { body } = await http()
        .get(`/api/v1/events/${eventId}/exports`)
        .set('Authorization', authorization)
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0].asset.url).toEqual(expect.any(String));
    });

    it('refuses a designer', async () => {
      const { eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      await http()
        .post(`/api/v1/events/${eventId}/exports`)
        .set('Authorization', authorization)
        .send({ kind: 'GUEST_LIST' })
        .expect(403);
    });
  });
});
