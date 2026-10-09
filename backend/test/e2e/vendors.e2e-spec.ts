import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient, VendorCategory } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Vendor briefs over HTTP.
 *
 * The property under test is containment: a brief must carry exactly the
 * sections the booking lists and nothing else. That is a security boundary,
 * so it is asserted on the response body rather than inferred from the scopes
 * that were saved.
 */
describe('Vendor briefs (e2e)', () => {
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

  const caterer = () =>
    prisma.vendor.create({
      data: { name: 'Tashir Catering', category: VendorCategory.CATERING, email: 'c@test.local' },
    });

  const book = (eventId: string, authorization: string, body: Record<string, unknown>) =>
    http()
      .post(`/api/v1/events/${eventId}/vendors`)
      .set('Authorization', authorization)
      .send(body);

  describe('engaging a vendor', () => {
    it('mints a brief link with the category’s usual scopes', async () => {
      const { eventId, authorization } = await coordinator();
      const vendor = await caterer();

      const { body } = await book(eventId, authorization, { vendorId: vendor.id }).expect(201);

      expect(body.briefScopes).toEqual(['headcount', 'catering', 'timeline']);
      expect(body.briefToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('takes explicit scopes over the default', async () => {
      const { eventId, authorization } = await coordinator();
      const vendor = await caterer();

      const { body } = await book(eventId, authorization, {
        vendorId: vendor.id,
        briefScopes: ['bar'],
      }).expect(201);

      expect(body.briefScopes).toEqual(['bar']);
    });

    it('rejects a scope outside the vocabulary with a 400', async () => {
      const { eventId, authorization } = await coordinator();
      const vendor = await caterer();

      const { body } = await book(eventId, authorization, {
        vendorId: vendor.id,
        briefScopes: ['guest:contact:read'],
      }).expect(400);

      expect(Array.isArray(body.message)).toBe(true);
    });

    // B51: money is integer minor units everywhere; fees were the exception.
    it.each(['150000.00', '1.5', '-5'])('refuses a fee of %s, which is not whole minor units', async (feeMinor) => {
      const { eventId, authorization } = await coordinator();
      const vendor = await caterer();

      const { body } = await book(eventId, authorization, { vendorId: vendor.id, feeMinor }).expect(400);

      expect(JSON.stringify(body.message)).toContain('feeMinor');
    });

    // B48: re-booking returned the cancelled booking and its dead link.
    it('engages a cancelled vendor again, with a link that works', async () => {
      const { eventId, authorization } = await coordinator();
      const vendor = await caterer();
      const { body: first } = await book(eventId, authorization, { vendorId: vendor.id }).expect(201);
      await http().delete(`/api/v1/events/${eventId}/vendors/${first.id as string}`).set('Authorization', authorization).expect(200);

      const { body: again } = await book(eventId, authorization, { vendorId: vendor.id }).expect(201);

      expect(again.status).toBe('ENQUIRED');
      await http().get(`/api/v1/briefs/${again.briefToken as string}`).expect(200);
    });

    it('edits the existing engagement rather than opening a second', async () => {
      const { eventId, authorization } = await coordinator();
      const vendor = await caterer();

      await book(eventId, authorization, { vendorId: vendor.id }).expect(201);
      await book(eventId, authorization, { vendorId: vendor.id, briefScopes: ['bar'] }).expect(201);

      expect(await prisma.vendorBooking.count({ where: { eventId } })).toBe(1);
    });
  });

  describe('reading a brief', () => {
    const briefFor = async (scopes: string[]) => {
      const { eventId, authorization } = await coordinator();
      const vendor = await caterer();
      const { body } = await book(eventId, authorization, {
        vendorId: vendor.id,
        briefScopes: scopes,
      }).expect(201);
      return { eventId, authorization, bookingId: body.id as string, token: body.briefToken as string };
    };

    it('needs no account, only the link', async () => {
      const { token } = await briefFor(['headcount']);

      const { body } = await http().get(`/api/v1/briefs/${token}`).expect(200);

      expect(body.event.title).toEqual(expect.any(String));
      expect(body.headcount).toBeDefined();
    });

    /**
     * The containment property. A caterer's brief must not carry the playlist,
     * the seating plan or anyone's phone number, whatever else exists on the
     * event.
     */
    it('carries the granted sections and no others', async () => {
      const { token } = await briefFor(['headcount', 'catering']);

      const { body } = await http().get(`/api/v1/briefs/${token}`).expect(200);

      expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
        'catering',
        'event',
        'granted',
        'headcount',
        'status',
        'vendor',
      ]);
      for (const withheld of ['bar', 'playlist', 'seating', 'households', 'contacts']) {
        expect(body[withheld]).toBeUndefined();
      }
    });

    // B93: the headcount section carried every household's name, which only
    // the households scope is meant to give.
    it('gives headcount as numbers, without naming the households', async () => {
      const { token } = await briefFor(['headcount']);

      const { body } = await http().get(`/api/v1/briefs/${token}`).expect(200);

      expect(body.headcount).toMatchObject({ invited: expect.any(Number), attending: expect.any(Number) });
      expect(body.headcount).not.toHaveProperty('byHousehold');
      expect(JSON.stringify(body.headcount)).not.toContain('Fixture Household');
    });

    // So a vendor who can see what they were given does not ask by email.
    it('says which sections it carries and why', async () => {
      const { token } = await briefFor(['catering']);

      const { body } = await http().get(`/api/v1/briefs/${token}`).expect(200);

      expect(body.granted).toEqual([
        { section: 'catering', purpose: 'Covers and dietary requirements' },
      ]);
    });

    it('carries nothing beyond the event when no scope is granted', async () => {
      const { token } = await briefFor([]);

      const { body } = await http().get(`/api/v1/briefs/${token}`).expect(200);

      expect(body.granted).toEqual([]);
      expect(body.event).toBeDefined();
    });

    it('404s an unknown link', async () => {
      await http().get('/api/v1/briefs/not-a-real-token').expect(404);
    });

    /**
     * Rotation is the only revocation a capability URL has, so the old link
     * must stop working the moment a new one is issued.
     */
    it('stops working when the link is rotated', async () => {
      const { eventId, authorization, bookingId, token } = await briefFor(['headcount']);

      const { body: rotated } = await http()
        .post(`/api/v1/events/${eventId}/vendors/${bookingId}/rotate-brief`)
        .set('Authorization', authorization)
        .expect(201);

      expect(rotated.briefToken).not.toBe(token);
      await http().get(`/api/v1/briefs/${token}`).expect(404);
      await http().get(`/api/v1/briefs/${rotated.briefToken}`).expect(200);
    });

    it('refuses a cancelled engagement', async () => {
      const { eventId, authorization, bookingId, token } = await briefFor(['headcount']);

      await http()
        .delete(`/api/v1/events/${eventId}/vendors/${bookingId}`)
        .set('Authorization', authorization)
        .expect(200);

      // Cancelling also rotates, so the sent link is dead either way.
      await http().get(`/api/v1/briefs/${token}`).expect(404);
      const booking = await prisma.vendorBooking.findUniqueOrThrow({ where: { id: bookingId } });
      await http().get(`/api/v1/briefs/${booking.briefToken}`).expect(403);
    });
  });

  describe('who may see a fee', () => {
    const bookWithFee = async () => {
      const { eventId, authorization } = await coordinator();
      const vendor = await caterer();
      await book(eventId, authorization, { vendorId: vendor.id, feeMinor: '150000' }).expect(201);
      return { eventId };
    };

    it('shows the fee to a coordinator', async () => {
      const { eventId } = await bookWithFee();
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.COORDINATOR,
      });

      const { body } = await http()
        .get(`/api/v1/events/${eventId}/vendors`)
        .set('Authorization', authorization)
        .expect(200);

      expect(body[0]).toMatchObject({ feeMinor: '150000', feeCurrency: 'AMD' });
      expect(body[0].briefToken).toMatch(/^[0-9a-f]{64}$/);
    });

    // vendor:fee:read is separate from vendor:read for exactly this case.
    it('hides the fee from a viewer who may still see the vendor', async () => {
      const { eventId } = await bookWithFee();
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.VIEWER,
      });

      const { body } = await http()
        .get(`/api/v1/events/${eventId}/vendors`)
        .set('Authorization', authorization)
        .expect(200);

      expect(body[0].vendor.name).toBe('Tashir Catering');
      expect(body[0]).not.toHaveProperty('feeMinor');
      // B11: the brief link is a credential; with the contacts scope it reads guests' phones.
      expect(body[0]).not.toHaveProperty('briefToken');
    });

    it('refuses a designer entirely', async () => {
      const { eventId } = await bookWithFee();
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.DESIGNER,
      });

      await http()
        .get(`/api/v1/events/${eventId}/vendors`)
        .set('Authorization', authorization)
        .expect(403);
    });
  });
});
