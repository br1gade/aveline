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

    it('issues one fresh brief token when rebooking a cancelled engagement concurrently', async () => {
      const { eventId, authorization } = await coordinator();
      const vendor = await caterer();
      const { body: earlier } = await book(eventId, authorization, { vendorId: vendor.id }).expect(201);
      await http().delete(`/api/v1/events/${eventId}/vendors/${earlier.id as string}`).set('Authorization', authorization).expect(200);
      const renew = () => book(eventId, authorization, { vendorId: vendor.id }).expect(201);
      const [one, two] = await Promise.all([renew(), renew()]);
      expect(one.body).toMatchObject({ id: earlier.id, status: 'ENQUIRED', isBriefEnabled: true });
      expect(one.body.briefToken).toBe(two.body.briefToken);
      expect(one.body.briefToken).not.toBe(earlier.briefToken);
      await http().get(`/api/v1/briefs/${one.body.briefToken as string}`).expect(200);
      await http().get(`/api/v1/briefs/${earlier.briefToken as string}`).expect(404);
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
      return { eventId, authorization, vendorId: vendor.id, bookingId: body.id as string, token: body.briefToken as string };
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
      expect(body.headcount).not.toHaveProperty('trend');
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

    it('reveals seating only while published and omits guest IDs and release identities', async () => {
      const { eventId, token } = await briefFor(['seating']);
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId } });
      const table = await prisma.table.create({ data: { eventId, name: 'Hidden until published', capacity: 4 } });
      await prisma.rsvp.update({ where: { guestId: guest.id }, data: { status: 'ATTENDING' } });
      await prisma.seat.create({ data: { tableId: table.id, guestId: guest.id, position: 1 } });
      const declined = await prisma.guest.create({ data: { eventId, householdId: guest.householdId, firstName: 'Declined private name',
        token: 'declined-vendor-fixture', rsvp: { create: { status: 'DECLINED' } } } });
      await prisma.seatRelease.create({ data: { eventId, arrangementId: table.arrangementId, tableId: table.id, guestId: declined.id, releasedAt: new Date('2026-11-01T12:00:00Z') } });
      const read = () => http().get(`/api/v1/briefs/${token}`).expect(200);
      const hidden = await read();
      expect(hidden.body).not.toHaveProperty('seating');
      expect(hidden.body.granted).toEqual([]);
      await prisma.event.update({ where: { id: eventId }, data: { seatingPublishedAt: new Date('2026-11-01T12:00:00Z') } });
      const published = await read().expect('Cache-Control', 'private, no-store');
      expect(published.body.seating).toEqual([expect.objectContaining({ name: table.name, capacity: 4, releasedCount: 1,
        guests: [{ name: [guest.firstName, guest.lastName].filter(Boolean).join(' '), position: 1 }] })]);
      expect(JSON.stringify(published.body.seating)).not.toMatch(/guestId|Declined private name|"released"/);
      await prisma.guest.update({ where: { id: guest.id }, data: { anonymizedAt: new Date('2026-11-02T12:00:00Z') } });
      const erased = await read();
      expect(erased.body.seating[0]).toMatchObject({ seated: 1, available: 3, guests: [] });
      await prisma.event.update({ where: { id: eventId }, data: { seatingPublishedAt: null } });
      expect((await read()).body).not.toHaveProperty('seating');
    });

    it('pauses the same link, keeps booking/scopes on retry and rotation, and permits explicit resume', async () => {
      const { eventId, authorization, vendorId, bookingId, token } = await briefFor(['headcount']);
      const path = `/api/v1/events/${eventId}/vendors/${bookingId}`;
      const patch = (body: Record<string, unknown>) => http().patch(path).set('Authorization', authorization).send(body);
      const viewer = await authenticateAs(app, prisma, { eventId, role: EventRole.VIEWER });
      await http().patch(path).set('Authorization', viewer.authorization).send({ isBriefEnabled: false }).expect(403);
      const paused = await patch({ isBriefEnabled: false }).expect(200);
      expect(paused.body).toMatchObject({ id: bookingId, status: 'ENQUIRED', isBriefEnabled: false, briefScopes: ['headcount'] });
      expect(await prisma.vendorBooking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ briefToken: token });
      const denied = await http().get(`/api/v1/briefs/${token}`).expect(403);
      expect(denied.body).not.toHaveProperty('event');
      const retry = await book(eventId, authorization, { vendorId }).expect(201);
      expect(retry.body).toMatchObject({ briefToken: token, isBriefEnabled: false, briefScopes: ['headcount'] });
      await book(eventId, authorization, { vendorId, briefScopes: null }).expect(400);
      await patch({ briefScopes: null }).expect(400);
      const { body: rotated } = await http().post(`${path}/rotate-brief`).set('Authorization', authorization).expect(201);
      expect(rotated.isBriefEnabled).toBe(false);
      await http().get(`/api/v1/briefs/${token}`).expect(404);
      await http().get(`/api/v1/briefs/${rotated.briefToken as string}`).expect(403);
      await patch({ isBriefEnabled: null }).expect(400);
      await patch({ isBriefEnabled: true }).expect(200);
      await http().get(`/api/v1/briefs/${rotated.briefToken as string}`).expect(200);
    });

    it('404s an unknown link', async () => {
      await http().get('/api/v1/briefs/not-a-real-token').expect(404);
    });

    /**
     * Rotation permanently retires the old link when a replacement is issued.
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

    // B83: cancelling by PATCH kept the link, and PATCHing back revived it.
    it('kills the link when a booking is cancelled by edit, and does not revive it', async () => {
      const { eventId, authorization, bookingId, token } = await briefFor(['headcount']);
      const edit = (status: string) =>
        http().patch(`/api/v1/events/${eventId}/vendors/${bookingId}`).set('Authorization', authorization).send({ status }).expect(200);

      await edit('CANCELLED');
      await http().get(`/api/v1/briefs/${token}`).expect(403);
      await edit('CONFIRMED');

      await http().get(`/api/v1/briefs/${token}`).expect(404);
    });

    it('refuses a cancelled engagement', async () => {
      const { eventId, authorization, bookingId, token } = await briefFor(['headcount']);

      await http()
        .delete(`/api/v1/events/${eventId}/vendors/${bookingId}`)
        .set('Authorization', authorization)
        .expect(200);

      const result = await http().get(`/api/v1/briefs/${token}`).expect(403);
      expect(result.body).not.toHaveProperty('event');
      const booking = await prisma.vendorBooking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.briefToken).toBe(token);
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
