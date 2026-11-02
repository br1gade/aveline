import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { UNTHROTTLED } from '../../fixtures/unthrottled.fixture';
import { EventRole, OrganizationRole, PlatformRole, PrismaClient, RsvpStatus, VendorCategory } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Vendor bookings and briefs, and who may touch them: the gaps left by
 * vendors.e2e-spec.ts and access-rules.e2e-spec.ts. A brief is a capability
 * that can carry guests' phone numbers, so both what it contains and who may
 * mint, widen or kill one are asserted on the wire.
 */
/**
 * About a hundred sign-ins and brief reads run inside one throttle window
 * here, so on a fast machine the address limit would 429 a test by its
 * position in the file. rate-limiting.e2e-spec.ts owns the throttle.
 */

describe('Vendor bookings, briefs and access (coverage e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ThrottlerStorage)
      .useValue(UNTHROTTLED)
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
    const { authorization } = await authenticateAs(app, prisma, { eventId, role: EventRole.COORDINATOR });
    return { eventId, authorization };
  };

  const curatedVendor = (name = 'Tashir Catering', category: VendorCategory = VendorCategory.CATERING) =>
    prisma.vendor.create({ data: { name, category, email: 'c@test.local' } });

  const book = (eventId: string, authorization: string, body: Record<string, unknown>) =>
    http().post(`/api/v1/events/${eventId}/vendors`).set('Authorization', authorization).send(body);

  const patch = (eventId: string, bookingId: string, authorization: string, body: Record<string, unknown>) =>
    http().patch(`/api/v1/events/${eventId}/vendors/${bookingId}`).set('Authorization', authorization).send(body);

  const brief = (token: string) => http().get(`/api/v1/briefs/${token}`);

  /** A coordinator's event with one booked caterer. */
  const booked = async (body: Record<string, unknown> = { briefScopes: ['headcount'], feeMinor: '150000' }) => {
    const { eventId, authorization } = await coordinator();
    const vendor = await curatedVendor();
    const { body: booking } = await book(eventId, authorization, { vendorId: vendor.id, ...body }).expect(201);
    return { eventId, authorization, vendorId: vendor.id, bookingId: booking.id as string, token: booking.briefToken as string };
  };

  const organizationOf = async (eventId: string) =>
    (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { organizationId: true } })).organizationId;

  /** An account in the given organization, or a fresh one. */
  const memberOf = async (role: OrganizationRole, organizationId?: string) => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    const id = organizationId ?? (await prisma.organization.create({ data: { name: `Org ${randomUUID().slice(0, 4)}`, kind: 'HOST' } })).id;
    await prisma.organizationMembership.create({ data: { userId, organizationId: id, role } });
    return { authorization, userId, organizationId: id };
  };

  const staffAccount = async (platformRole: PlatformRole) => {
    const account = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: account.userId }, data: { platformRole } });
    return account;
  };

  const messagesOf = (body: unknown) => {
    const { message } = body as { message?: unknown };
    return (Array.isArray(message) ? message : [message]) as unknown[];
  };
  const namesField = (body: unknown, field: string) =>
    messagesOf(body).some((message) => typeof message === 'string' && message.includes(field));

  interface GuestSeed {
    firstName: string;
    lastName: string;
    status: RsvpStatus;
    email?: string;
    phone?: string;
    household: string;
    rsvp?: { dietary?: string[]; drinkPreference?: string; songRequest?: string };
  }

  const addGuest = async (eventId: string, seed: GuestSeed) => {
    const household = await prisma.household.create({ data: { eventId, name: seed.household, seatsAllotted: 2 } });
    return prisma.guest.create({
      data: {
        eventId,
        householdId: household.id,
        firstName: seed.firstName,
        lastName: seed.lastName,
        email: seed.email ?? null,
        phone: seed.phone ?? null,
        token: randomUUID().replace(/-/g, '').slice(0, 12),
        isPrimary: true,
        rsvp: { create: { status: seed.status, ...seed.rsvp } },
      },
    });
  };

  describe('editing a booking', () => {
    // docs/API.md: "An unrecognised scope is a 400." PATCH has its own decorators.
    it('refuses an unrecognised scope on edit, naming briefScopes, and keeps the stored scopes', async () => {
      const { eventId, authorization, bookingId } = await booked();

      const { body } = await patch(eventId, bookingId, authorization, { briefScopes: ['guest:contact:read'] }).expect(400);

      expect(namesField(body, 'briefScopes')).toBe(true);
      expect((await prisma.vendorBooking.findUniqueOrThrow({ where: { id: bookingId } })).briefScopes).toEqual(['headcount']);
    });

    it.each([
      ['150000.00'],
      ['1.5'],
      ['-5'],
      [150000],
      ['1234567890123456'],
      [''],
    ])('refuses a fee of %p on edit, naming feeMinor, and keeps the stored fee', async (feeMinor) => {
      const { eventId, authorization, bookingId } = await booked();

      const { body } = await patch(eventId, bookingId, authorization, { feeMinor }).expect(400);

      expect(namesField(body, 'feeMinor')).toBe(true);
      expect((await prisma.vendorBooking.findUniqueOrThrow({ where: { id: bookingId } })).feeMinor).toBe(150000n);
    });

    it('changes the scopes alone, keeping status and fee, and the live link shows the new scopes', async () => {
      const { eventId, authorization, bookingId, token } = await booked({ briefScopes: ['headcount'], feeMinor: '100' });

      const { body } = await patch(eventId, bookingId, authorization, { briefScopes: ['bar'] }).expect(200);

      expect(body).toMatchObject({ briefScopes: ['bar'], feeMinor: '100', status: 'ENQUIRED' });
      expect(body).not.toHaveProperty('briefToken');
      const { body: served } = await brief(token).expect(200);
      expect((served.granted as { section: string }[]).map((entry) => entry.section)).toEqual(['bar']);
      expect(served).not.toHaveProperty('headcount');
    });

    it('changes the fee alone, keeping the scopes, the status and the link', async () => {
      const { eventId, authorization, bookingId, token } = await booked({ briefScopes: ['bar'], feeMinor: '100' });

      const { body } = await patch(eventId, bookingId, authorization, { feeMinor: '200' }).expect(200);

      expect(body).toMatchObject({ briefScopes: ['bar'], feeMinor: '200', status: 'ENQUIRED' });
      const stored = await prisma.vendorBooking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(stored).toMatchObject({ feeMinor: 200n, briefScopes: ['bar'], status: 'ENQUIRED', briefToken: token });
    });
  });

  describe('engaging a vendor', () => {
    it.each([[150000], ['1234567890123456'], ['']])('refuses a fee of %p, naming feeMinor, and books nothing', async (feeMinor) => {
      const { eventId, authorization } = await coordinator();
      const vendor = await curatedVendor();

      const { body } = await book(eventId, authorization, { vendorId: vendor.id, feeMinor }).expect(400);

      expect(namesField(body, 'feeMinor')).toBe(true);
      expect(await prisma.vendorBooking.count()).toBe(0);
    });

    it('takes a fee of fifteen digits, the most minor units allowed', async () => {
      const { eventId, authorization } = await coordinator();
      const vendor = await curatedVendor();

      const { body } = await book(eventId, authorization, { vendorId: vendor.id, feeMinor: '999999999999999' }).expect(201);

      expect(body.feeMinor).toBe('999999999999999');
    });

    it('keeps the link and the fee when the same vendor is booked again without one', async () => {
      const { eventId, authorization } = await coordinator();
      const vendor = await curatedVendor();
      const { body: first } = await book(eventId, authorization, { vendorId: vendor.id, feeMinor: '150000' }).expect(201);

      const { body: second } = await book(eventId, authorization, { vendorId: vendor.id, briefScopes: ['bar'] }).expect(201);

      expect(second).toMatchObject({ id: first.id, briefToken: first.briefToken, briefScopes: ['bar'], feeMinor: '150000' });
      const { body: served } = await brief(first.briefToken as string).expect(200);
      expect(served.granted).toEqual([{ section: 'bar', purpose: expect.any(String) }]);
    });

    it('lets an organization book its own vendor on its own event', async () => {
      const { eventId } = await seedEvent(prisma);
      const owner = await memberOf(OrganizationRole.OWNER, await organizationOf(eventId));
      const { body: ours } = await http()
        .post('/api/v1/vendors')
        .set('Authorization', owner.authorization)
        .send({ name: 'Cousin Aram', category: 'PHOTOGRAPHY' })
        .expect(201);

      const { body } = await book(eventId, owner.authorization, { vendorId: ours.id }).expect(201);

      expect(body.vendor.id).toBe(ours.id);
      const { body: served } = await brief(body.briefToken as string).expect(200);
      expect(served.vendor).toEqual({ name: 'Cousin Aram', category: 'PHOTOGRAPHY' });
    });
  });

  describe('adding a vendor to the directory', () => {
    it('refuses an account with no organization and no staff role, adding nothing', async () => {
      const { authorization } = await authenticateAs(app, prisma);

      const { body } = await http().post('/api/v1/vendors').set('Authorization', authorization).send({ name: 'Nobody’s Caterer', category: 'CATERING' }).expect(403);

      expect(body.message).toBe('This account may not vendor:write');
      expect(await prisma.vendor.count()).toBe(0);
    });

    it.each([OrganizationRole.MEMBER, OrganizationRole.VIEWER])('refuses an organization %s, adding nothing', async (role) => {
      const { authorization } = await memberOf(role);

      const { body } = await http().post('/api/v1/vendors').set('Authorization', authorization).send({ name: 'Read-only Caterer', category: 'CATERING' }).expect(403);

      expect(body.message).toBe('This account may not vendor:write');
      expect(await prisma.vendor.count()).toBe(0);
    });
  });

  describe('a brief over the link alone', () => {
    it('names the vendor, the engagement and the event with its zone and venues', async () => {
      const { eventId, token } = await booked({ briefScopes: [] });
      const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });

      const { body } = await brief(token).expect(200);

      expect(body).toMatchObject({
        vendor: { name: 'Tashir Catering', category: 'CATERING' },
        status: 'ENQUIRED',
        event: {
          title: 'Fixture Wedding',
          startsAt: event.startsAt.toISOString(),
          timezone: event.timezone,
          venues: [expect.objectContaining({ name: 'Fixture Hall', role: 'RECEPTION' })],
        },
      });
    });
  });

  describe('what each section carries', () => {
    const attending: GuestSeed = {
      firstName: 'Ani',
      lastName: 'Attending',
      status: RsvpStatus.ATTENDING,
      email: 'ani.attending@example.am',
      phone: '+37491111111',
      household: 'Attending Household',
      rsvp: { dietary: ['vegetarian'], drinkPreference: 'wine', songRequest: 'Ani’s Song' },
    };
    const declined: GuestSeed = {
      firstName: 'Davit',
      lastName: 'Declined',
      status: RsvpStatus.DECLINED,
      email: 'davit.declined@example.am',
      phone: '+37492222222',
      household: 'Declined Household',
    };

    const briefWith = async (briefScopes: string[]) => {
      const { eventId, authorization } = await coordinator();
      await addGuest(eventId, attending);
      await addGuest(eventId, declined);
      const vendor = await curatedVendor();
      const { body } = await book(eventId, authorization, { vendorId: vendor.id, briefScopes }).expect(201);
      const { body: served } = await brief(body.briefToken as string).expect(200);
      return { eventId, authorization, served };
    };

    it('lists only attending guests’ contacts', async () => {
      const { served } = await briefWith(['contacts']);

      expect(served.contacts).toEqual([{ name: 'Ani Attending', email: attending.email, phone: attending.phone }]);
      expect(JSON.stringify(served)).not.toContain(declined.phone);
      expect(JSON.stringify(served)).not.toContain(declined.email);
    });

    it('groups only attending guests by household, by name and nothing more', async () => {
      const { served } = await briefWith(['households']);

      expect(served.households).toEqual([{ household: 'Attending Household', guests: ['Ani Attending'] }]);
      const text = JSON.stringify(served);
      for (const secret of [attending.email, attending.phone, declined.email, declined.phone, 'Davit']) {
        expect(text).not.toContain(secret);
      }
    });

    it.each([
      ['catering', 'catering-sheet', 'vegetarian'],
      ['bar', 'bar-sheet', 'wine'],
      ['playlist', 'playlist', 'Ani’s Song'],
    ])('gives the %s section as the host’s own %s shows it', async (section, path, attendingAnswer) => {
      const { eventId, authorization, served } = await briefWith([section]);

      const { body: hosts } = await http().get(`/api/v1/events/${eventId}/${path}`).set('Authorization', authorization).expect(200);

      expect(served[section]).toEqual(hosts);
      expect(JSON.stringify(served[section])).toContain(attendingAnswer);
    });

    it('gives the seating section as the host’s own table list shows it', async () => {
      const { eventId, authorization } = await coordinator();
      await http().post(`/api/v1/events/${eventId}/tables`).set('Authorization', authorization).send({ name: 'Table One', capacity: 8 }).expect(201);
      const vendor = await curatedVendor();
      const { body } = await book(eventId, authorization, { vendorId: vendor.id, briefScopes: ['seating'] }).expect(201);

      const { body: served } = await brief(body.briefToken as string).expect(200);
      const { body: hosts } = await http().get(`/api/v1/events/${eventId}/tables`).set('Authorization', authorization).expect(200);

      expect(served.seating).toEqual(hosts);
      expect(JSON.stringify(served.seating)).toContain('Table One');
    });

    it('gives the running order in the event’s own language', async () => {
      const { eventId, authorization } = await coordinator();
      await http()
        .post(`/api/v1/events/${eventId}/timeline`)
        .set('Authorization', authorization)
        .send({ label: { hy: 'Պսակադրություն', en: 'Ceremony' }, occursAt: '2027-06-12T16:00:00Z' })
        .expect(201);
      const vendor = await curatedVendor();
      const { body } = await book(eventId, authorization, { vendorId: vendor.id, briefScopes: ['timeline'] }).expect(201);

      const { body: served } = await brief(body.briefToken as string).expect(200);

      expect(served.timeline).toEqual([{ label: 'Պսակադրություն', occursAt: '2027-06-12T16:00:00.000Z', venue: null }]);
    });
  });

  describe('a brief and another event', () => {
    it('carries nothing from another event, whatever it is granted', async () => {
      const a = await coordinator();
      const b = await coordinator();
      await addGuest(b.eventId, {
        firstName: 'Other',
        lastName: 'Guest',
        status: RsvpStatus.ATTENDING,
        email: 'other.guest@example.am',
        phone: '+37493333333',
        household: 'Other Household',
        rsvp: { dietary: ['other-diet'], drinkPreference: 'other-drink', songRequest: 'Other Song' },
      });
      await http().post(`/api/v1/events/${b.eventId}/timeline`).set('Authorization', b.authorization).send({ label: { hy: 'Other Ceremony' }, occursAt: '2027-06-12T16:00:00Z' }).expect(201);
      await http().post(`/api/v1/events/${b.eventId}/tables`).set('Authorization', b.authorization).send({ name: 'Other Table', capacity: 8 }).expect(201);
      const vendor = await curatedVendor();
      const everything = ['headcount', 'catering', 'bar', 'playlist', 'timeline', 'seating', 'households', 'contacts'];
      const { body } = await book(a.eventId, a.authorization, { vendorId: vendor.id, briefScopes: everything }).expect(201);

      const { body: served } = await brief(body.briefToken as string).expect(200);

      expect(served.granted).toHaveLength(everything.length);
      const text = JSON.stringify(served);
      for (const theirs of ['Other Guest', 'Other Household', 'other.guest@example.am', '+37493333333', 'other-diet', 'other-drink', 'Other Song', 'Other Ceremony', 'Other Table']) {
        expect(text).not.toContain(theirs);
      }
    });

    describe('a booking reached through another event', () => {
      const foreign = async () => {
        const a = await booked();
        const b = await coordinator();
        return { a, b, url: `/api/v1/events/${b.eventId}/vendors/${a.bookingId}` };
      };

      const assertUntouched = async (a: Awaited<ReturnType<typeof booked>>) => {
        const booking = await prisma.vendorBooking.findUniqueOrThrow({ where: { id: a.bookingId } });
        expect(booking).toMatchObject({ status: 'ENQUIRED', briefToken: a.token, eventId: a.eventId });
        await brief(a.token).expect(200);
      };

      it('404s an edit and leaves the booking as it was', async () => {
        const { a, b, url } = await foreign();

        await http().patch(url).set('Authorization', b.authorization).send({ status: 'CANCELLED' }).expect(404);

        await assertUntouched(a);
      });

      it('404s a rotation and leaves the link working', async () => {
        const { a, b, url } = await foreign();

        await http().post(`${url}/rotate-brief`).set('Authorization', b.authorization).expect(404);

        await assertUntouched(a);
      });

      it('404s a cancellation and leaves the booking as it was', async () => {
        const { a, b, url } = await foreign();

        await http().delete(url).set('Authorization', b.authorization).expect(404);

        await assertUntouched(a);
      });

      it('404s a booking that does not exist on the event', async () => {
        const { eventId, authorization } = await booked();
        const url = `/api/v1/events/${eventId}/vendors/no-such-booking`;

        await http().patch(url).set('Authorization', authorization).send({ status: 'CONFIRMED' }).expect(404);
        await http().post(`${url}/rotate-brief`).set('Authorization', authorization).expect(404);
        await http().delete(url).set('Authorization', authorization).expect(404);
      });
    });
  });

  describe('who may see a fee', () => {
    const listAs = async (eventId: string, authorization: string) =>
      ((await http().get(`/api/v1/events/${eventId}/vendors`).set('Authorization', authorization).expect(200)).body as Record<string, unknown>[])[0];

    it.each([OrganizationRole.OWNER, OrganizationRole.MANAGER])('shows the fee to an organization %s', async (role) => {
      const { eventId } = await booked();
      const { authorization } = await memberOf(role, await organizationOf(eventId));

      expect(await listAs(eventId, authorization)).toMatchObject({ feeMinor: '150000', feeCurrency: 'AMD' });
    });

    it.each([PlatformRole.SUPPORT, PlatformRole.ADMIN])('shows the fee to platform %s with no membership', async (role) => {
      const { eventId } = await booked();
      const { authorization } = await staffAccount(role);

      expect(await listAs(eventId, authorization)).toMatchObject({ feeMinor: '150000', feeCurrency: 'AMD' });
    });

    it.each([OrganizationRole.MEMBER, OrganizationRole.VIEWER])('hides the fee and the link from an organization %s', async (role) => {
      const { eventId } = await booked();
      const { authorization } = await memberOf(role, await organizationOf(eventId));

      const row = await listAs(eventId, authorization);

      expect(row.vendor).toMatchObject({ name: 'Tashir Catering' });
      expect(row).not.toHaveProperty('feeMinor');
      expect(row).not.toHaveProperty('briefToken');
    });
  });

  describe('who may change an event’s vendors', () => {
    interface Caller { label: string; join: (eventId: string) => Promise<{ authorization: string }> }
    const callers: Caller[] = [
      { label: 'an event DESIGNER', join: (eventId) => authenticateAs(app, prisma, { eventId, role: EventRole.DESIGNER }) },
      { label: 'an event VIEWER', join: (eventId) => authenticateAs(app, prisma, { eventId, role: EventRole.VIEWER }) },
      { label: 'an organization MEMBER', join: async (eventId) => memberOf(OrganizationRole.MEMBER, await organizationOf(eventId)) },
      { label: 'an organization VIEWER', join: async (eventId) => memberOf(OrganizationRole.VIEWER, await organizationOf(eventId)) },
    ];

    const assertUntouched = async (setup: Awaited<ReturnType<typeof booked>>) => {
      expect(await prisma.vendorBooking.count()).toBe(1);
      const booking = await prisma.vendorBooking.findUniqueOrThrow({ where: { id: setup.bookingId } });
      expect(booking).toMatchObject({ status: 'ENQUIRED', briefToken: setup.token, briefScopes: ['headcount'], feeMinor: 150000n });
      await brief(setup.token).expect(200);
    };

    it.each(callers)('refuses $label a booking, even one asking for contacts', async ({ join }) => {
      const setup = await booked();
      const { authorization } = await join(setup.eventId);
      const other = await curatedVendor('Other Photographer', VendorCategory.PHOTOGRAPHY);

      await book(setup.eventId, authorization, { vendorId: other.id, briefScopes: ['contacts'] }).expect(403);

      await assertUntouched(setup);
    });

    it.each(callers)('refuses $label an edit', async ({ join }) => {
      const setup = await booked();
      const { authorization } = await join(setup.eventId);

      await patch(setup.eventId, setup.bookingId, authorization, { status: 'CANCELLED', briefScopes: ['contacts'] }).expect(403);

      await assertUntouched(setup);
    });

    it.each(callers)('refuses $label a rotation', async ({ join }) => {
      const setup = await booked();
      const { authorization } = await join(setup.eventId);

      await http().post(`/api/v1/events/${setup.eventId}/vendors/${setup.bookingId}/rotate-brief`).set('Authorization', authorization).expect(403);

      await assertUntouched(setup);
    });

    it.each(callers)('refuses $label a cancellation', async ({ join }) => {
      const setup = await booked();
      const { authorization } = await join(setup.eventId);

      await http().delete(`/api/v1/events/${setup.eventId}/vendors/${setup.bookingId}`).set('Authorization', authorization).expect(403);

      await assertUntouched(setup);
    });
  });

  describe('an organization role and another organization’s event', () => {
    it.each([OrganizationRole.OWNER, OrganizationRole.MANAGER])('gives an organization %s no standing on an event elsewhere', async (role) => {
      const { authorization } = await memberOf(role);
      const { eventId } = await seedEvent(prisma);
      const vendor = await curatedVendor();
      const as = (req: request.Test) => req.set('Authorization', authorization).expect(403);

      await as(http().get(`/api/v1/events/${eventId}`));
      await as(http().get(`/api/v1/events/${eventId}/guests`));
      await as(http().get(`/api/v1/events/${eventId}/vendors`));
      await as(http().patch(`/api/v1/events/${eventId}`).send({ title: 'Taken over' }));
      await as(book(eventId, authorization, { vendorId: vendor.id }));

      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).title).toBe('Fixture Wedding');
      expect(await prisma.vendorBooking.count()).toBe(0);
    });
  });

  describe('what a concierge operator may not do', () => {
    it('refuses a SUPPORT account with no membership archiving or deleting an event', async () => {
      const { eventId } = await seedEvent(prisma);
      const { authorization } = await staffAccount(PlatformRole.SUPPORT);

      await http().post(`/api/v1/events/${eventId}/archive`).set('Authorization', authorization).expect(403);
      await http().delete(`/api/v1/events/${eventId}`).set('Authorization', authorization).expect(403);

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      expect(event?.status).toBe('PUBLISHED');
    });

    // The other side of the boundary: a platform role can archive without a membership, so the refusal above is SUPPORT's own.
    it('lets a platform ADMIN with no membership archive the same event', async () => {
      const { eventId } = await seedEvent(prisma);
      const { authorization } = await staffAccount(PlatformRole.ADMIN);

      await http().post(`/api/v1/events/${eventId}/archive`).set('Authorization', authorization).expect(201);

      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('ARCHIVED');
    });

    it('refuses a SUPPORT account a customer’s subscription, read or changed', async () => {
      const { eventId } = await seedEvent(prisma);
      const organizationId = await organizationOf(eventId);
      const { authorization } = await staffAccount(PlatformRole.SUPPORT);
      const as = (req: request.Test) => req.set('Authorization', authorization).set('x-aveline-organization-id', organizationId).expect(403);

      await as(http().get('/api/v1/subscription'));
      await as(http().post('/api/v1/subscription').send({ planKey: 'pro' }));

      expect(await prisma.subscription.count()).toBe(0);
    });

    it('lets a platform ADMIN with no membership read the same subscription', async () => {
      const { eventId } = await seedEvent(prisma);
      const organizationId = await organizationOf(eventId);
      const { authorization } = await staffAccount(PlatformRole.ADMIN);

      await http().get('/api/v1/subscription').set('Authorization', authorization).set('x-aveline-organization-id', organizationId).expect(200);
    });
  });
});
