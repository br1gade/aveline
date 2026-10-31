import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ThrottlerStorage } from '@nestjs/throttler';
import { EventRole, MessageChannel, PlatformRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { SerializeInterceptor } from '../../../src/common/interceptors/serialize';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { SeatingRunner } from '../../../src/modules/seating/jobs/seating-runner';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { guestPathIn, seedPlatformDefaults, withoutHouseholdNames } from '../../fixtures/areas/journey-08.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const UNTHROTTLED: ThrottlerStorage = {
  increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

type Brief = Record<string, unknown> & { granted: { section: string }[] };
interface Booking { id: string; briefToken: string; briefScopes: string[]; status: string }
interface Household { household: string; guests: string[] }
interface BriefTable { venue: string | null; name: string; seated: number; guests: { name: string }[]; released: { name: string }[] }

/**
 * Journey 8: a vendor is booked, handed a link, and reads only what the
 * booking grants — numbers that follow the guests' own answers given over
 * HTTP, a link that dies when rotated or cancelled, and names that vanish
 * when a guest is erased.
 *
 *   Petrosyan family (3 seats, side A): Armen answers for Lusine
 *     (vegetarian) and adds Narek, a plus-one with a nut allergy.
 *   Sargsyan (1 seat, side B): Mariam comes, vegetarian; later erased.
 *   Hakobyan (1 seat, side B): Tigran declines.
 *   Avetisyan (1 seat, side A): Ani never answers.
 */
describe('Journey 08: vendor booking, scoped brief links that follow the guests’ answers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      // One host does a week's work in seconds, faster than the per-account
      // throttle allows a person; rate-limiting.e2e owns that rule.
      .overrideProvider(ThrottlerStorage).useValue(UNTHROTTLED)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // Worker steps are driven in-process; a wall-clock cron would race them.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await seedPlatformDefaults(prisma);
  });

  afterAll(async () => {
    const email = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS).get(MessageChannel.EMAIL);
    if (email instanceof SmtpTransport) email.close();
    await app.close();
    await disconnectTestDatabase();
  });

  const registerHost = async () => {
    const email = `host-${randomUUID().slice(0, 8)}@journey8.test`;
    const password = 'a-long-enough-journey-password';
    await http().post(api('/auth/register')).send({ email, password, name: 'Anna Host' }).expect(202);
    const { body: session } = await http().post(api('/auth/login')).send({ email, password }).expect(201);
    const authorization = `Bearer ${session.accessToken as string}`;
    await http().post(api('/organizations')).set('Authorization', authorization).send({ name: 'Anna & Davit', kind: 'HOST' }).expect(201);
    return authorization;
  };

  /** Aveline staff, who add to the curated directory every organization books from. */
  const directoryVendor = async (name: string, category: string) => {
    const staff = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: staff.userId }, data: { platformRole: PlatformRole.SUPPORT } });
    const { body } = await http().post(api('/vendors')).set('Authorization', staff.authorization).send({ name, category }).expect(201);
    return body.id as string;
  };

  const createEvent = async (authorization: string) => {
    // Whole hours ten days out: far enough that no RSVP deadline or reminder is near.
    const startsAt = new Date(Math.ceil((Date.now() + 10 * DAY_MS) / HOUR_MS) * HOUR_MS);
    const { body: event } = await http().post(api('/events')).set('Authorization', authorization).send({
      type: 'WEDDING', title: 'Anna & Davit', templateKey: 'classic', timezone: 'Asia/Yerevan',
      startsAt: startsAt.toISOString(), locales: ['en', 'hy'], defaultLocale: 'en',
    }).expect(201);
    return { eventId: event.id as string, slug: event.invitation.slug as string, startsAt };
  };

  const importGuests = async (authorization: string, eventId: string, csv: string[]) => {
    const { body } = await http().post(api(`/events/${eventId}/guests/import`)).set('Authorization', authorization)
      .attach('file', Buffer.from(csv.join('\n')), { filename: 'guests.csv', contentType: 'text/csv' }).expect(201);
    expect(body).toMatchObject({ status: 'COMPLETED', rowsImported: csv.length - 1, rowsFailed: 0 });
  };

  /** Publish and send: each guest's personal link exists only in the message they were sent. */
  const publishAndSend = async (authorization: string, event: { eventId: string; slug: string }) => {
    await http().post(api(`/invitations/${event.slug}/publish`)).set('Authorization', authorization).expect(201);
    await http().post(api(`/invitations/${event.slug}/send`)).set('Authorization', authorization).send({}).expect(201);
    await app.get(CommunicationsService).dispatchDue();
    const messages = await prisma.message.findMany({ where: { eventId: event.eventId, templateKey: 'invitation.send' }, select: { toAddress: true, body: true } });
    return new Map(messages.map((message) => [message.toAddress, guestPathIn(message.body)]));
  };

  /** A coordinator on the event, who books the vendors — not the owner. */
  const coordinatorOf = async (eventId: string) =>
    (await authenticateAs(app, prisma, { eventId, role: EventRole.COORDINATOR })).authorization;

  const book = async (authorization: string, eventId: string, body: Record<string, unknown>) =>
    (await http().post(api(`/events/${eventId}/vendors`)).set('Authorization', authorization).send(body).expect(201)).body as Booking;

  const brief = async (token: string) => (await http().get(api(`/briefs/${token}`)).expect(200)).body as Brief;

  const hostView = async (authorization: string, path: string) =>
    (await http().get(api(path)).set('Authorization', authorization).expect(200)).body as Record<string, unknown>;

  const sortedHouseholds = (households: Household[]) =>
    households.map((entry) => ({ household: entry.household, guests: [...entry.guests].sort() }));

  describe('event-wide answers', () => {
    const GUEST_CSV = [
      'First name,Last name,Email,Phone,Household,Seats,Side,Locale',
      'Armen,Petrosyan,armen@journey8.test,+37491000001,Petrosyan family,3,A,en',
      'Lusine,Petrosyan,,,Petrosyan family,3,A,en',
      'Mariam,Sargsyan,mariam@journey8.test,+37491000002,Sargsyan,1,B,en',
      'Tigran,Hakobyan,tigran@journey8.test,+37491000003,Hakobyan,1,B,en',
      'Ani,Avetisyan,ani@journey8.test,+37491000004,Avetisyan,1,A,en',
    ];

    /** One hall, dietary and drink choices, a public and an internal timeline entry, and the guest list. */
    const setUpEvent = async (authorization: string) => {
      const as = <T extends request.Test>(call: T) => call.set('Authorization', authorization);
      const event = await createEvent(authorization);
      await as(http().patch(api(`/invitations/${event.slug}/rsvp-fields`))).send({
        dietary: { options: [{ key: 'vegetarian', label: { en: 'Vegetarian', hy: 'Բուսակեր' } }] },
        drinkPreference: { options: [{ key: 'wine', label: { en: 'Wine', hy: 'Գինի' } }] },
      }).expect(200);
      const { body: hall } = await as(http().post(api(`/events/${event.eventId}/venues`)))
        .send({ role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan', capacity: 120 }).expect(201);
      const timeline = { arrives: new Date(event.startsAt.getTime() - 3 * HOUR_MS).toISOString(), dinner: new Date(event.startsAt.getTime() + HOUR_MS).toISOString() };
      await as(http().post(api(`/events/${event.eventId}/timeline`)))
        .send({ label: { en: 'Caterer arrives', hy: 'Սննդի մատակարարը ժամանում է' }, occursAt: timeline.arrives, venueId: hall.id, isInternal: true }).expect(201);
      await as(http().post(api(`/events/${event.eventId}/timeline`)))
        .send({ label: { en: 'Dinner', hy: 'Ընթրիք' }, occursAt: timeline.dinner, venueId: hall.id }).expect(201);
      await importGuests(authorization, event.eventId, GUEST_CSV);
      return { ...event, timeline };
    };

    /** Guests answer through the links they were sent. */
    const guestsAnswer = async (links: Map<string, string>) => {
      const armen = links.get('armen@journey8.test')!;
      const { body: form } = await http().get(api(`${armen}/rsvp`)).expect(200);
      const lusine = (form.household.members as { id: string; firstName: string }[]).find((member) => member.firstName === 'Lusine')!;
      const { body: answer } = await http().post(api(`${armen}/rsvp`)).send({
        status: 'ATTENDING', drinkPreference: 'wine',
        members: [{ guestId: lusine.id, status: 'ATTENDING', dietary: ['vegetarian'] }],
        party: [{ firstName: 'Narek', lastName: 'Petrosyan', dietaryNotes: 'severe nut allergy' }],
      }).expect(201);
      expect(answer).toMatchObject({ status: 'ATTENDING', partyAdded: 1, membersAnswered: 1 });
      await http().post(api(`${links.get('mariam@journey8.test')!}/rsvp`)).send({ status: 'ATTENDING', dietary: ['vegetarian'], drinkPreference: 'wine' }).expect(201);
      await http().post(api(`${links.get('tigran@journey8.test')!}/rsvp`)).send({ status: 'DECLINED' }).expect(201);
    };

    /** Before anyone answers, the brief is honest zeros and the running order; ungranted sections are absent. */
    const expectEmptyBriefs = (caterer: Brief, photographer: Brief, timeline: { arrives: string; dinner: string }) => {
      expect(caterer.granted.map((entry) => entry.section)).toEqual(['headcount', 'catering', 'timeline']);
      expect(Object.keys(caterer).sort()).toEqual(['catering', 'event', 'granted', 'headcount', 'status', 'timeline', 'vendor']);
      expect(caterer).toMatchObject({ vendor: { name: 'Tashir Catering', category: 'CATERING' }, status: 'ENQUIRED', event: { title: 'Anna & Davit', timezone: 'Asia/Yerevan' } });
      expect(caterer.headcount).toMatchObject({ invited: 5, households: 4, attending: 0, declined: 0, pending: 5, responseRate: 0 });
      expect(caterer.catering).toEqual({ covers: 0, requirements: [], notes: [] });
      // The internal entry is for the people running the day, so the vendor sees it.
      expect(caterer.timeline).toEqual([
        { label: 'Caterer arrives', occursAt: timeline.arrives, venue: 'Ararat Hall' },
        { label: 'Dinner', occursAt: timeline.dinner, venue: 'Ararat Hall' },
      ]);
      expect(photographer.granted.map((entry) => entry.section)).toEqual(['households', 'contacts']);
      expect(Object.keys(photographer).sort()).toEqual(['contacts', 'event', 'granted', 'households', 'status', 'vendor']);
      expect(photographer).toMatchObject({ households: [], contacts: [] });
    };

    /** The caterer's numbers are the host's numbers, without the households named. */
    const expectCatererFollowsAnswers = async (authorization: string, eventId: string, caterer: Brief) => {
      const headcount = await hostView(authorization, `/events/${eventId}/headcount`);
      // The host sees the named breakdown; the vendor gets the same numbers without it.
      expect(headcount).toHaveProperty('byHousehold');
      expect(caterer.headcount).not.toHaveProperty('byHousehold');
      expect(caterer.headcount).toEqual(withoutHouseholdNames(headcount));
      expect(caterer.headcount).toMatchObject({ invited: 6, households: 4, attending: 4, declined: 1, pending: 1 });
      const bySide = new Map((caterer.headcount as { bySide: { side: string }[] }).bySide.map((side) => [side.side, side]));
      expect(bySide.get('SIDE_A')).toMatchObject({ invited: 4, attending: 3, declined: 0, pending: 1 });
      expect(bySide.get('SIDE_B')).toMatchObject({ invited: 2, attending: 1, declined: 1, pending: 0 });
      expect(caterer.catering).toEqual(await hostView(authorization, `/events/${eventId}/catering-sheet`));
      expect(caterer.catering).toEqual({
        covers: 4,
        requirements: [{ requirement: 'Vegetarian', key: 'vegetarian', count: 2 }],
        notes: [{ guest: 'Narek Petrosyan', household: 'Petrosyan family', note: 'severe nut allergy' }],
      });
      // Nobody's address reaches the kitchen.
      expect(JSON.stringify(caterer)).not.toMatch(/@journey8\.test|\+3749/);
    };

    const expectPhotographerFollowsAnswers = (photographer: Brief) => {
      expect(sortedHouseholds(photographer.households as Household[])).toEqual([
        { household: 'Petrosyan family', guests: ['Armen Petrosyan', 'Lusine Petrosyan', 'Narek Petrosyan'] },
        { household: 'Sargsyan', guests: ['Mariam Sargsyan'] },
      ]);
      // Only people who are coming: Tigran declined, Ani never answered.
      const contacts = photographer.contacts as { name: string; email: string | null; phone: string | null }[];
      expect(contacts.map((contact) => contact.name).sort()).toEqual(['Armen Petrosyan', 'Lusine Petrosyan', 'Mariam Sargsyan', 'Narek Petrosyan']);
      expect(contacts.find((contact) => contact.name === 'Mariam Sargsyan')).toMatchObject({ email: 'mariam@journey8.test', phone: '+37491000002' });
      expect(JSON.stringify(photographer)).not.toMatch(/Tigran|Ani|tigran@|ani@/);
    };

    /** Rotation kills the forwarded link at once; the new one reads the same numbers. */
    const rotateCatererLink = async (coordinator: string, eventId: string, caterer: Booking) => {
      const before = await brief(caterer.briefToken);
      const { body: rotated } = await http().post(api(`/events/${eventId}/vendors/${caterer.id}/rotate-brief`)).set('Authorization', coordinator).expect(201);
      await http().get(api(`/briefs/${caterer.briefToken}`)).expect(404);
      expect(await brief(rotated.briefToken as string)).toEqual(before);
      return rotated.briefToken as string;
    };

    /** Cancelling kills the sent link and refuses the current one; re-engaging gives a working link. */
    const cancelAndReengage = async (coordinator: string, eventId: string, photographer: Booking) => {
      await http().delete(api(`/events/${eventId}/vendors/${photographer.id}`)).set('Authorization', coordinator).expect(200);
      await http().get(api(`/briefs/${photographer.briefToken}`)).expect(404);
      const { body: listed } = await http().get(api(`/events/${eventId}/vendors`)).set('Authorization', coordinator).expect(200);
      const cancelled = (listed as (Booking & { vendor: { id: string } })[]).find((booking) => booking.id === photographer.id)!;
      expect(cancelled.status).toBe('CANCELLED');
      await http().get(api(`/briefs/${cancelled.briefToken}`)).expect(403);
      const reengaged = await book(coordinator, eventId, { vendorId: cancelled.vendor.id, briefScopes: ['households', 'contacts'] });
      expect(reengaged).toMatchObject({ id: photographer.id, status: 'ENQUIRED' });
      expect([photographer.briefToken, cancelled.briefToken]).not.toContain(reengaged.briefToken);
      return reengaged;
    };

    const eraseByRequest = async (subjectEmail: string) => {
      const officer = await authenticateAs(app, prisma);
      await prisma.user.update({ where: { id: officer.userId }, data: { platformRole: PlatformRole.ADMIN } });
      const as = <T extends request.Test>(call: T) => call.set('Authorization', officer.authorization);
      await http().post(api('/privacy/requests')).send({ kind: 'ERASURE', subjectEmail }).expect(201);
      const { body: received } = await as(http().get(api('/privacy/requests?status=RECEIVED'))).expect(200);
      const requestId = (received as { id: string; subjectEmail: string }[]).find((item) => item.subjectEmail === subjectEmail)!.id;
      await as(http().patch(api(`/privacy/requests/${requestId}`))).send({ status: 'IN_PROGRESS' }).expect(200);
      const { body } = await as(http().post(api(`/privacy/requests/${requestId}/fulfil`))).expect(201);
      expect(body.guestsAnonymised).toBe(1);
    };

    /** Erasure keeps the cover the caterer is paid for but drops her name, her address and her diet. */
    const expectErasureRedacts = async (catererToken: string, photographerToken: string) => {
      const caterer = await brief(catererToken);
      expect(caterer.headcount).toMatchObject({ attending: 4 });
      expect(caterer.catering).toMatchObject({ covers: 4, requirements: [{ key: 'vegetarian', count: 1 }] });
      const photographer = await brief(photographerToken);
      const households = sortedHouseholds(photographer.households as Household[]);
      expect(households).toContainEqual({ household: 'Petrosyan family', guests: ['Armen Petrosyan', 'Lusine Petrosyan', 'Narek Petrosyan'] });
      expect(households).toContainEqual({ household: expect.stringMatching(/^Household \d+$/), guests: ['Removed'] });
      expect((photographer.contacts as { name: string }[]).find((contact) => contact.name === 'Removed')).toEqual({ name: 'Removed', email: null, phone: null });
      for (const read of [caterer, photographer]) expect(JSON.stringify(read)).not.toMatch(/Mariam|Sargsyan|mariam@|\+37491000002/);
    };

    it('books directory and own vendors whose scoped briefs follow HTTP answers, die on rotate or cancel, and lose an erased guest', async () => {
      const host = await registerHost();
      const event = await setUpEvent(host);
      const catererId = await directoryVendor('Tashir Catering', 'CATERING');
      const { body: own } = await http().post(api('/vendors')).set('Authorization', host)
        .send({ name: 'Cousin Aram, photographer', category: 'PHOTOGRAPHY', phone: '+37499000000' }).expect(201);
      const { body: choices } = await http().get(api('/vendors')).set('Authorization', host).expect(200);
      expect((choices as { name: string; isCurated: boolean }[]).map((vendor) => [vendor.name, vendor.isCurated]))
        .toEqual(expect.arrayContaining([['Tashir Catering', true], ['Cousin Aram, photographer', false]]));

      const coordinator = await coordinatorOf(event.eventId);
      const caterer = await book(coordinator, event.eventId, { vendorId: catererId, feeMinor: '1500000' });
      expect(caterer).toMatchObject({ status: 'ENQUIRED', briefScopes: ['headcount', 'catering', 'timeline'], feeMinor: '1500000', feeCurrency: 'AMD' });
      const photographer = await book(coordinator, event.eventId, { vendorId: own.id, briefScopes: ['contacts', 'households'] });
      expectEmptyBriefs(await brief(caterer.briefToken), await brief(photographer.briefToken), event.timeline);

      await guestsAnswer(await publishAndSend(host, event));
      await expectCatererFollowsAnswers(host, event.eventId, await brief(caterer.briefToken));
      expectPhotographerFollowsAnswers(await brief(photographer.briefToken));

      const catererToken = await rotateCatererLink(coordinator, event.eventId, caterer);
      const reengaged = await cancelAndReengage(coordinator, event.eventId, photographer);
      expectPhotographerFollowsAnswers(await brief(reengaged.briefToken));

      await eraseByRequest('mariam@journey8.test');
      await expectErasureRedacts(catererToken, reengaged.briefToken);
    }, 120_000);
  });

  /**
   * Two venues answered separately. The venue's brief counts each room from
   * that room's answers and shows the seats the seating worker gave; the
   * caterer's covers are everyone coming anywhere, as the host's sheet is.
   *
   *   Petrosyan family (3 seats): Armen goes to both; Lusine to the ceremony
   *     only; Armen adds Narek (vegetarian), reception only.
   *   Sargsyan (1 seat): Mariam, reception only — until she cancels it.
   *   Hakobyan (1 seat): Tigran declines both.
   */
  describe('per-venue answers', () => {
    const GUEST_CSV = [
      'First name,Last name,Email,Household,Seats,Locale',
      'Armen,Petrosyan,armen@journey8.test,Petrosyan family,3,en',
      'Lusine,Petrosyan,,Petrosyan family,3,en',
      'Mariam,Sargsyan,mariam@journey8.test,Sargsyan,1,en',
      'Tigran,Hakobyan,tigran@journey8.test,Hakobyan,1,en',
    ];

    interface Venues { eventId: string; slug: string; church: string; hall: string; revision: number }

    const setUpTwoVenues = async (authorization: string): Promise<Venues> => {
      const as = <T extends request.Test>(call: T) => call.set('Authorization', authorization);
      const event = await createEvent(authorization);
      await as(http().patch(api(`/invitations/${event.slug}/rsvp-fields`)))
        .send({ dietary: { options: [{ key: 'vegetarian', label: { en: 'Vegetarian', hy: 'Բուսակեր' } }] } }).expect(200);
      const venue = async (role: string, name: string) =>
        (await as(http().post(api(`/events/${event.eventId}/venues`))).send({ role, name, address: `${name}, Yerevan`, capacity: 60 }).expect(201)).body.id as string;
      const church = await venue('CEREMONY', 'Saint Gayane');
      const hall = await venue('RECEPTION', 'Ararat Hall');
      await as(http().post(api(`/events/${event.eventId}/tables/bulk`))).send({ venueId: church, namePrefix: 'Pew', count: 1, capacity: 6 }).expect(201);
      await as(http().post(api(`/events/${event.eventId}/tables/bulk`))).send({ venueId: hall, namePrefix: 'Table', count: 1, capacity: 6 }).expect(201);
      await importGuests(authorization, event.eventId, GUEST_CSV);
      const { body: preview } = await as(http().post(api(`/events/${event.eventId}/attendance-policy/preview`))).send({ mode: 'PER_VENUE' }).expect(201);
      const { body: policy } = await as(http().post(api(`/events/${event.eventId}/attendance-policy`)))
        .send({ ...preview.request, transitionId: randomUUID() }).expect(201);
      expect(policy).toMatchObject({ mode: 'PER_VENUE', revision: 2 });
      return { ...event, church, hall, revision: policy.revision as number };
    };

    const answerPerVenue = async (venues: Venues, links: Map<string, string>) => {
      const at = (church: string, hall: string) => [{ venueId: venues.church, status: church }, { venueId: venues.hall, status: hall }];
      const armen = links.get('armen@journey8.test')!;
      const { body: form } = await http().get(api(`${armen}/rsvp`)).expect(200);
      const lusine = (form.household.members as { id: string; firstName: string }[]).find((member) => member.firstName === 'Lusine')!;
      await http().post(api(`${armen}/rsvp`)).send({
        attendanceRevision: venues.revision, venueAttendance: at('ATTENDING', 'ATTENDING'),
        members: [{ guestId: lusine.id, venueAttendance: at('ATTENDING', 'DECLINED') }],
        party: [{ firstName: 'Narek', lastName: 'Petrosyan', dietary: ['vegetarian'], venueAttendance: at('DECLINED', 'ATTENDING') }],
      }).expect(201);
      await http().post(api(`${links.get('mariam@journey8.test')!}/rsvp`)).send({ attendanceRevision: venues.revision, venueAttendance: at('DECLINED', 'ATTENDING') }).expect(201);
      await http().post(api(`${links.get('tigran@journey8.test')!}/rsvp`)).send({ attendanceRevision: venues.revision, venueAttendance: at('DECLINED', 'DECLINED') }).expect(201);
    };

    /** One seating job per venue's arrangement, run by the real worker. */
    const seatEachVenue = async (authorization: string, venues: Venues) => {
      const arrangements = await hostView(authorization, `/events/${venues.eventId}/seating/arrangements`) as unknown as { id: string; venueId: string | null }[];
      for (const venueId of [venues.church, venues.hall]) {
        const arrangement = arrangements.find((candidate) => candidate.venueId === venueId)!;
        const { body: job } = await http().post(api(`/events/${venues.eventId}/seats/auto-assign?arrangementId=${arrangement.id}`))
          .set('Authorization', authorization).send({ idempotencyKey: randomUUID() }).expect(201);
        expect(await app.get(SeatingRunner).runOne()).toBe(true);
        expect(await hostView(authorization, `/events/${venues.eventId}/seating/jobs/${job.id as string}`)).toMatchObject({ status: 'COMPLETED', result: { unseated: [] } });
      }
    };

    const venueCounts = (headcount: unknown, venueId: string) =>
      (headcount as { venues: { venueId: string }[] }).venues.find((venue) => venue.venueId === venueId);

    const seatedAt = (seating: unknown, venue: string) =>
      (seating as BriefTable[]).filter((table) => table.venue === venue).flatMap((table) => table.guests.map((guest) => guest.name)).sort();

    /** Each room counted and seated from that room's answers; covers from anyone coming anywhere. */
    const expectVenueBrief = async (authorization: string, venues: Venues, briefs: { venue: string; caterer: string }) => {
      const venueBrief = await brief(briefs.venue);
      expect(venueBrief.granted.map((entry) => entry.section)).toEqual(['headcount', 'timeline', 'seating']);
      expect(Object.keys(venueBrief).sort()).toEqual(['event', 'granted', 'headcount', 'seating', 'status', 'timeline', 'vendor']);
      const dashboard = await hostView(authorization, `/events/${venues.eventId}/dashboard`);
      expect((venueBrief.headcount as { venues: unknown[] }).venues).toEqual((dashboard.headcount as { venues: unknown[] }).venues);
      expect(venueCounts(venueBrief.headcount, venues.church)).toMatchObject({ attending: 2, declined: 3, pending: 0 });
      expect(venueCounts(venueBrief.headcount, venues.hall)).toMatchObject({ attending: 3, declined: 2, pending: 0 });
      expect(venueBrief.headcount).toMatchObject({ invited: 5, attending: 4 });
      expect(seatedAt(venueBrief.seating, 'Saint Gayane')).toEqual(['Armen Petrosyan', 'Lusine Petrosyan']);
      expect(seatedAt(venueBrief.seating, 'Ararat Hall')).toEqual(['Armen Petrosyan', 'Mariam Sargsyan', 'Narek Petrosyan']);

      const caterer = await brief(briefs.caterer);
      expect(caterer.catering).toEqual(await hostView(authorization, `/events/${venues.eventId}/catering-sheet`));
      expect(caterer.catering).toMatchObject({ covers: 4, requirements: [{ key: 'vegetarian', count: 1 }] });
    };

    /** A venue decline frees that room's seat and count only; the brief shows the gap and who left it. */
    const expectVenueDeclineFollows = async (venues: Venues, links: Map<string, string>, briefs: { venue: string; caterer: string }) => {
      await http().post(api(`${links.get('mariam@journey8.test')!}/rsvp`))
        .send({ attendanceRevision: venues.revision, venueAttendance: [{ venueId: venues.hall, status: 'DECLINED' }] }).expect(201);
      const venueBrief = await brief(briefs.venue);
      expect(venueCounts(venueBrief.headcount, venues.hall)).toMatchObject({ attending: 2, declined: 3 });
      expect(venueCounts(venueBrief.headcount, venues.church)).toMatchObject({ attending: 2, declined: 3 });
      expect(seatedAt(venueBrief.seating, 'Ararat Hall')).toEqual(['Armen Petrosyan', 'Narek Petrosyan']);
      const hallTable = (venueBrief.seating as BriefTable[]).find((table) => table.venue === 'Ararat Hall')!;
      expect(hallTable).toMatchObject({ seated: 2, released: [expect.objectContaining({ name: 'Mariam Sargsyan' })] });
      expect(seatedAt(venueBrief.seating, 'Saint Gayane')).toEqual(['Armen Petrosyan', 'Lusine Petrosyan']);
      expect((await brief(briefs.caterer)).catering).toMatchObject({ covers: 3 });
    };

    it('gives a venue brief per-room counts and worker-made seats from per-venue answers, and follows a venue decline', async () => {
      const host = await registerHost();
      const venues = await setUpTwoVenues(host);
      const coordinator = await coordinatorOf(venues.eventId);
      const venueVendor = await book(coordinator, venues.eventId, { vendorId: await directoryVendor('Ararat Hall Ltd', 'VENUE') });
      const caterer = await book(coordinator, venues.eventId, { vendorId: await directoryVendor('Tashir Catering', 'CATERING'), briefScopes: ['catering'] });
      const briefs = { venue: venueVendor.briefToken, caterer: caterer.briefToken };
      expect(Object.keys(await brief(briefs.caterer)).sort()).toEqual(['catering', 'event', 'granted', 'status', 'vendor']);

      const links = await publishAndSend(host, venues);
      await answerPerVenue(venues, links);
      await seatEachVenue(host, venues);
      await expectVenueBrief(host, venues, briefs);
      await expectVenueDeclineFollows(venues, links, briefs);
    }, 120_000);
  });
});
