import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, EventType, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The guest's side of an invitation over HTTP: which language the personal
 * page is shown in, what a closed invitation still allows, which links the
 * reply form refuses, and how per-venue attendance is held to its contract
 * (docs/API.md §4). Also the public listing's visibility rules.
 */
describe('Guest flow coverage (e2e)', () => {
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

  const guestPath = (slug: string, token: string) => `/api/v1/invitations/${slug}/g/${token}`;
  const storedLocale = async (token: string) => (await prisma.guest.findUniqueOrThrow({ where: { token } })).locale;
  const heroOf = (body: unknown) => (body as { blocks: { type: string; content: unknown }[] }).blocks.find((block) => block.type === 'HERO')?.content;

  describe('the personal page language', () => {
    /** The event publishes hy (its default) and en; this guest's own language is English. */
    const englishGuest = async () => {
      const seeded = await seedEvent(prisma);
      await prisma.guest.update({ where: { token: seeded.primaryGuestToken }, data: { locale: 'en' } });
      return { ...seeded, path: guestPath(seeded.slug, seeded.primaryGuestToken) };
    };

    it('uses the guest’s stored language rather than the event default when no locale is asked for', async () => {
      const { path } = await englishGuest();

      const { body } = await http().get(path).expect(200);

      expect(body.locale).toBe('en');
      expect(heroOf(body)).toEqual({ title: 'Hello' });
    });

    it('lets an explicit ?locale win over the guest’s stored language', async () => {
      const { path } = await englishGuest();

      const { body } = await http().get(path).query({ locale: 'hy' }).expect(200);

      expect(body.locale).toBe('hy');
      expect(heroOf(body)).toEqual({ title: 'Բարև' });
    });

    it('falls back to the guest’s stored language, not the event default, when ?locale is not published', async () => {
      const { path } = await englishGuest();

      const { body } = await http().get(path).query({ locale: 'ru' }).expect(200);

      expect(body.locale).toBe('en');
      expect(heroOf(body)).toEqual({ title: 'Hello' });
    });

    it('does not change the guest’s stored language when the page is switched with ?locale', async () => {
      const { path, primaryGuestToken } = await englishGuest();

      expect((await http().get(path).query({ locale: 'hy' }).expect(200)).body.locale).toBe('hy');

      expect(await storedLocale(primaryGuestToken)).toBe('en');
      expect((await http().get(path).expect(200)).body.locale).toBe('en');
    });

    it('stores the language an RSVP is sent in, gives it to a new plus-one, and shows the page in it afterwards', async () => {
      const { primaryGuestToken, slug, householdId } = await seedEvent(prisma, { seatsAllotted: 2 });
      await prisma.guest.update({ where: { token: primaryGuestToken }, data: { locale: 'hy' } });
      const path = guestPath(slug, primaryGuestToken);

      await http().post(`${path}/rsvp`).send({ status: 'ATTENDING', locale: 'en', party: [{ firstName: 'Narek' }] }).expect(201);

      expect(await storedLocale(primaryGuestToken)).toBe('en');
      const plusOne = await prisma.guest.findFirstOrThrow({ where: { householdId, addedByGuest: true } });
      expect(plusOne).toMatchObject({ firstName: 'Narek', locale: 'en' });
      expect((await http().get(path).expect(200)).body.locale).toBe('en');
    });

    it('gives a new plus-one the respondent’s stored language when the RSVP names no locale', async () => {
      const { primaryGuestToken, householdId, path } = await englishGuest();

      await http().post(`${path}/rsvp`).send({ status: 'ATTENDING', party: [{ firstName: 'Narek' }] }).expect(201);

      expect(await storedLocale(primaryGuestToken)).toBe('en');
      expect(await prisma.guest.findFirstOrThrow({ where: { householdId, addedByGuest: true } })).toMatchObject({ firstName: 'Narek', locale: 'en' });
    });
  });

  describe('name correction on a closed invitation', () => {
    it('still lets the guest correct their name once the invitation is closed but readable', async () => {
      const { slug, primaryGuestToken } = await seedEvent(prisma);
      await prisma.invitation.update({ where: { slug }, data: { status: 'CLOSED', expiresAt: null } });

      const { body } = await http().patch(`${guestPath(slug, primaryGuestToken)}/name`).send({ firstName: 'Ani' }).expect(200);

      expect(body).toMatchObject({ firstName: 'Ani', lastName: 'Guest', name: 'Ani Guest' });
      expect(await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken } })).toMatchObject({ firstName: 'Ani' });
    });
  });

  describe('reply-form links that are not anyone’s', () => {
    it('returns 404 when the reply form is read with an unknown token', async () => {
      const { slug } = await seedEvent(prisma);

      await http().get(`${guestPath(slug, 'not-a-real-token')}/rsvp`).expect(404);
    });

    it('returns 404 for an erased respondent’s still-stored token on both reading and answering, changing nothing', async () => {
      const { slug, primaryGuestToken } = await seedEvent(prisma);
      await prisma.guest.update({ where: { token: primaryGuestToken }, data: { anonymizedAt: new Date() } });
      const path = `${guestPath(slug, primaryGuestToken)}/rsvp`;

      await http().get(path).expect(404);
      await http().post(path).send({ status: 'ATTENDING' }).expect(404);

      const guest = await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken }, include: { rsvp: true } });
      expect(guest.rsvp).toMatchObject({ status: 'PENDING', respondedAt: null });
    });
  });

  describe('per-venue attendance', () => {
    /** A seeded event switched to PER_VENUE (revision 2) through the host's preview-then-confirm. */
    const perVenue = async () => {
      const event = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.OWNER });
      const policyPath = `/api/v1/events/${event.eventId}/attendance-policy`;
      const preview = await http().post(`${policyPath}/preview`).set('Authorization', authorization).send({ mode: 'PER_VENUE' }).expect(201);
      await http().post(policyPath).set('Authorization', authorization).send({ ...preview.body.request, transitionId: randomUUID() }).expect(201);
      const hall = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
      return { ...event, authorization, hall, path: guestPath(event.slug, event.primaryGuestToken) };
    };
    const messageOf = (body: unknown) => JSON.stringify((body as { message: unknown }).message);

    // The page's flag before and after answering is journey-03's; this is the reply form's.
    it('flags reconfirmation on the reply form right after the transition', async () => {
      const { path } = await perVenue();

      const { body } = await http().get(`${path}/rsvp`).expect(200);

      expect(body.attendance).toMatchObject({ mode: 'PER_VENUE', revision: 2, status: 'PENDING', needsReconfirmation: true });
    });

    it('refuses an answer for a preparation venue with a 400 naming venueAttendance, recording nothing', async () => {
      const { path, eventId, hall } = await perVenue();
      const preparation = await prisma.venue.create({ data: { eventId, role: 'PREPARATION', name: 'Bride’s house', address: '9 Test St' } });

      const { body } = await http().post(`${path}/rsvp`).send({
        attendanceRevision: 2,
        venueAttendance: [{ venueId: hall.id, status: 'ATTENDING' }, { venueId: preparation.id, status: 'ATTENDING' }],
      }).expect(400);

      expect(messageOf(body)).toMatch(/venueAttendance: venue is not guest-facing/);
      expect(await prisma.attendanceResponse.count({ where: { revision: 2 } })).toBe(0);
    });

    it.each([
      [100, 'reaches validation of venue IDs'],
      [101, 'is refused by size'],
    ])('bounds venueAttendance at 100 answers per person: %i %s', async (count) => {
      const { path } = await perVenue();
      const venueAttendance = Array.from({ length: count }, (_, i) => ({ venueId: `venue-${i}`, status: 'ATTENDING' }));

      const { body } = await http().post(`${path}/rsvp`).send({ attendanceRevision: 2, venueAttendance }).expect(400);

      // 100 passes the DTO and is refused only because the IDs are not this event's venues.
      const expected = count > 100 ? 'venueAttendance must contain no more than 100 elements' : 'venueAttendance: venue is not guest-facing on this event';
      expect(messageOf(body)).toContain(expected);
      expect(await prisma.attendanceResponse.count({ where: { revision: 2 } })).toBe(0);
    });
  });

  it('refuses venueAttendance on an event-wide event with a 400 naming it, leaving the answer unchanged', async () => {
    const { slug, primaryGuestToken, eventId } = await seedEvent(prisma);
    const hall = await prisma.venue.findFirstOrThrow({ where: { eventId } });

    const { body } = await http().post(`${guestPath(slug, primaryGuestToken)}/rsvp`).send({
      status: 'ATTENDING', venueAttendance: [{ venueId: hall.id, status: 'ATTENDING' }],
    }).expect(400);

    expect(JSON.stringify(body.message)).toMatch(/venueAttendance: this event takes one event-wide answer/);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken }, include: { rsvp: true } });
    expect(guest.rsvp).toMatchObject({ status: 'PENDING', respondedAt: null });
  });

  describe('public listing visibility', () => {
    const at = (path: string, authorization: string) => ({
      post: (body: object = {}) => http().post(path).set('Authorization', authorization).send(body),
      put: (body: object) => http().put(path).set('Authorization', authorization).send(body),
      patch: (body: object) => http().patch(path).set('Authorization', authorization).send(body),
    });

    /** A PUBLIC event with an indexable listing, published through the API. */
    const publishedIndexable = async () => {
      const { authorization } = await authenticateAs(app, prisma);
      await http().post('/api/v1/organizations').set('Authorization', authorization).send({ name: 'Yerevan Jazz' }).expect(201);
      const { body: event } = await http().post('/api/v1/events').set('Authorization', authorization)
        .send({ type: EventType.OTHER, title: 'Autumn Jazz Night', startsAt: '2027-10-01T18:00:00.000Z' }).expect(201);
      const base = `/api/v1/events/${event.id as string}`;
      await at(`${base}/settings`, authorization).patch({ visibility: 'PUBLIC' }).expect(200);
      const { body: listing } = await at(`${base}/listing`, authorization)
        .put({ headline: { en: 'Autumn Jazz Night' }, isIndexable: true }).expect(200);
      await at(`${base}/listing/publish`, authorization).post().expect(201);
      return { authorization, base, slug: listing.slug as string };
    };
    const browsedSlugs = async () =>
      ((await http().get('/api/v1/public/events').expect(200)).body as { items: { slug: string }[] }).items.map((item) => item.slug);

    it('takes a published indexable listing out of browse and indexing when the event turns UNLISTED, keeping it reachable by slug', async () => {
      const { authorization, base, slug } = await publishedIndexable();
      expect(await browsedSlugs()).toContain(slug);
      expect((await http().get(`/api/v1/public/events/${slug}`).expect(200)).body.metadata.robots).toBe('index,follow');

      await at(`${base}/settings`, authorization).patch({ visibility: 'UNLISTED' }).expect(200);

      expect(await browsedSlugs()).not.toContain(slug);
      const { body } = await http().get(`/api/v1/public/events/${slug}`).expect(200);
      expect(body.metadata.robots).toBe('noindex,nofollow');
    });
  });
});
