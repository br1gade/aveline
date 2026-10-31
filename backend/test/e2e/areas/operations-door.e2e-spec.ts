import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient, RsvpStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { TicketCancellationService } from '../../../src/modules/ticketing/ticket-cancellation.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { attendeeRoster, ticketEvent } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The operations sheets and the door on the day, over HTTP: who the catering
 * sheet counts, which venues it answers for, what the door screen says, and
 * who may use it (docs/API.md "Operations", "Check-in on the day",
 * "Admitting a ticket at the door").
 */
describe('Operations sheets and the door (coverage, e2e)', () => {
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

  const coordinator = async () => {
    const event = await seedEvent(prisma, { seatsAllotted: 6 });
    const { authorization } = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.COORDINATOR });
    const primary = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    return { ...event, authorization, primary };
  };

  const addGuest = async (
    event: { eventId: string; householdId: string },
    firstName: string,
    rsvp: { status: RsvpStatus; dietary?: string[]; dietaryNotes?: string; drinkPreference?: string },
  ) => prisma.guest.create({
    data: {
      eventId: event.eventId, householdId: event.householdId, firstName, lastName: 'Petrosyan',
      token: randomUUID().replace(/-/g, '').slice(0, 12), attribution: 'SIDE_A', rsvp: { create: rsvp },
    },
  });

  const checkInUrl = (eventId: string, guestId: string) => `/api/v1/events/${eventId}/guests/${guestId}/check-in`;

  describe('the catering sheet without a venue', () => {
    const answeredEvent = async () => {
      const event = await coordinator();
      await addGuest(event, 'Armen', { status: 'ATTENDING', dietary: ['vegan'], dietaryNotes: 'nut allergy' });
      await addGuest(event, 'Mariam', { status: 'DECLINED', dietary: ['vegan'], dietaryNotes: 'declined note' });
      await addGuest(event, 'Lusine', { status: 'PENDING', dietary: ['halal'], dietaryNotes: 'pending note' });
      await addGuest(event, 'Narek', { status: 'UNDECIDED', dietary: ['halal'], dietaryNotes: 'undecided note' });
      return event;
    };

    const expectedCatering = {
      covers: 1,
      requirements: [{ requirement: expect.any(String), key: 'vegan', count: 1 }],
      notes: [{ guest: 'Armen Petrosyan', household: 'Fixture Household', note: 'nut allergy' }],
    };

    it('counts covers, requirements and notes only for guests who are coming', async () => {
      const event = await answeredEvent();

      const { body } = await http().get(`/api/v1/events/${event.eventId}/catering-sheet`).set('Authorization', event.authorization).expect(200);

      expect(body).toEqual(expectedCatering);
    });

    it('shows the same attending-only catering on the dashboard', async () => {
      const event = await answeredEvent();

      const { body } = await http().get(`/api/v1/events/${event.eventId}/dashboard`).set('Authorization', event.authorization).expect(200);

      expect(body.catering).toEqual(expectedCatering);
    });
  });

  describe('a venue the sheets cannot answer for', () => {
    const hiddenVenues = async () => {
      const event = await coordinator();
      const hall = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
      const preparation = await prisma.venue.create({ data: { eventId: event.eventId, role: 'PREPARATION', name: 'Private home', address: 'Secret' } });
      const crew = await prisma.venue.create({ data: { eventId: event.eventId, role: 'AFTER_PARTY', name: 'Crew room', address: 'Backstage' } });
      await prisma.timelineEntry.create({ data: { eventId: event.eventId, venueId: crew.id, isInternal: true, occursAt: new Date(), label: { en: 'Crew briefing' } } });
      const other = await seedEvent(prisma);
      const foreign = await prisma.venue.findFirstOrThrow({ where: { eventId: other.eventId } });
      return { ...event, venues: { hall, preparation, crew, foreign } };
    };

    it('counts the catering sheet for the event’s own guest-facing venue', async () => {
      const event = await hiddenVenues();
      await addGuest(event, 'Armen', { status: 'ATTENDING', dietary: ['vegan'] });

      const { body } = await http().get(`/api/v1/events/${event.eventId}/catering-sheet`).query({ venueId: event.venues.hall.id }).set('Authorization', event.authorization).expect(200);

      expect(body).toMatchObject({ covers: 1, requirements: [expect.objectContaining({ key: 'vegan', count: 1 })] });
    });

    it('counts the bar sheet for the event’s own guest-facing venue', async () => {
      const event = await hiddenVenues();
      await addGuest(event, 'Armen', { status: 'ATTENDING', drinkPreference: 'wine' });

      const { body } = await http().get(`/api/v1/events/${event.eventId}/bar-sheet`).query({ venueId: event.venues.hall.id }).set('Authorization', event.authorization).expect(200);

      expect(body).toMatchObject({ totalResponses: 1, preferences: [expect.objectContaining({ key: 'wine', guests: 1, share: 100 })] });
    });

    it.each([
      ['catering-sheet', 'foreign'],
      ['catering-sheet', 'preparation'],
      ['catering-sheet', 'crew'],
      ['bar-sheet', 'foreign'],
      ['bar-sheet', 'preparation'],
      ['bar-sheet', 'crew'],
    ] as const)('%s refuses a %s venue with 404 naming venueId', async (sheet, which) => {
      const event = await hiddenVenues();

      const { body } = await http().get(`/api/v1/events/${event.eventId}/${sheet}`).query({ venueId: event.venues[which].id }).set('Authorization', event.authorization).expect(404);

      expect(body.message).toMatch(/^venueId:/);
    });
  });

  describe('the door screen', () => {
    it('names the guest, their table and that they were expected', async () => {
      const event = await coordinator();
      await prisma.rsvp.update({ where: { guestId: event.primary.id }, data: { status: 'ATTENDING' } });
      const { body: table } = await http().post(`/api/v1/events/${event.eventId}/tables`).set('Authorization', event.authorization).send({ name: 'Table 3', capacity: 8 }).expect(201);
      await http().post(`/api/v1/events/${event.eventId}/seats`).set('Authorization', event.authorization).send({ guestId: event.primary.id, tableId: table.id }).expect(201);

      const { body } = await http().post(checkInUrl(event.eventId, event.primary.id)).set('Authorization', event.authorization).expect(201);

      expect(body).toMatchObject({ guestId: event.primary.id, name: 'Primary Guest', table: 'Table 3', wasExpected: true, arrivedAt: expect.any(String) });
      expect(body.seating).toHaveLength(1);
      expect(body.seating[0]).toMatchObject({ table: 'Table 3' });
    });

    it.each(['DECLINED', 'PENDING', 'UNDECIDED'] as const)('flags a %s guest who turned up anyway as not expected', async (status) => {
      const event = await coordinator();
      const guest = await addGuest(event, 'Mariam', { status });

      const { body } = await http().post(checkInUrl(event.eventId, guest.id)).set('Authorization', event.authorization).expect(201);

      expect(body).toMatchObject({ guestId: guest.id, wasExpected: false, table: null });
    });

    it('answers a second check-in with 409 carrying the first arrival time, and keeps one arrival', async () => {
      const event = await coordinator();
      const url = checkInUrl(event.eventId, event.primary.id);
      const first = await http().post(url).set('Authorization', event.authorization).expect(201);

      const { body } = await http().post(url).set('Authorization', event.authorization).expect(409);

      expect(body.message).toBe(`Guest was already checked in at ${first.body.arrivedAt as string}`);
      expect(await prisma.checkIn.count({ where: { guestId: event.primary.id } })).toBe(1);
    });

    it.each(['post', 'delete'] as const)('does not %s a check-in for another event’s guest', async (method) => {
      const ours = await coordinator();
      const theirs = await seedEvent(prisma);
      const stranger = await prisma.guest.findUniqueOrThrow({ where: { token: theirs.primaryGuestToken } });
      if (method === 'delete') await prisma.checkIn.create({ data: { guestId: stranger.id } });
      const before = await prisma.checkIn.count({ where: { guestId: stranger.id } });

      const { body } = await http()[method](checkInUrl(ours.eventId, stranger.id)).set('Authorization', ours.authorization).expect(404);

      expect(body.message).toBe('That guest is not on this event');
      expect(await prisma.checkIn.count({ where: { guestId: stranger.id } })).toBe(before);
    });
  });

  describe('who may run the door', () => {
    it.each([
      ['post', EventRole.VIEWER],
      ['post', EventRole.DESIGNER],
      ['delete', EventRole.VIEWER],
      ['delete', EventRole.DESIGNER],
    ] as const)('refuses %s check-in to a %s', async (method, role) => {
      const event = await coordinator();
      await prisma.checkIn.create({ data: { guestId: event.primary.id, notedBy: null } });
      const outsider = await authenticateAs(app, prisma, { eventId: event.eventId, role });

      await http()[method](checkInUrl(event.eventId, event.primary.id)).set('Authorization', outsider.authorization).expect(403);

      expect(await prisma.checkIn.count({ where: { guestId: event.primary.id } })).toBe(1);
    });

    it.each(['post', 'delete'] as const)('refuses %s check-in without an account, even holding the guest link', async (method) => {
      const event = await coordinator();

      await http()[method](checkInUrl(event.eventId, event.primary.id)).query({ token: event.primaryGuestToken }).expect(401);

      expect(await prisma.checkIn.count()).toBe(0);
    });

    it('refuses arrivals to a designer', async () => {
      const event = await coordinator();
      const designer = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.DESIGNER });

      await http().get(`/api/v1/events/${event.eventId}/arrivals`).set('Authorization', designer.authorization).expect(403);
    });

    it('refuses arrivals to another event’s coordinator', async () => {
      const event = await coordinator();
      const other = await coordinator();

      await http().get(`/api/v1/events/${event.eventId}/arrivals`).set('Authorization', other.authorization).expect(403);
    });

    it('refuses arrivals without an account', async () => {
      const event = await coordinator();

      await http().get(`/api/v1/events/${event.eventId}/arrivals`).expect(401);
    });

    it('shows arrivals to a viewer', async () => {
      const event = await coordinator();
      const viewer = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.VIEWER });

      await prisma.checkIn.create({ data: { guestId: event.primary.id } });

      const { body } = await http().get(`/api/v1/events/${event.eventId}/arrivals`).set('Authorization', viewer.authorization).expect(200);

      expect(body).toMatchObject({ arrived: 1, recent: [expect.objectContaining({ name: 'Primary Guest' })] });
    });
  });

  describe('the ticket scanner', () => {
    const soldTicket = async () => {
      const event = await ticketEvent(prisma);
      const { body: order } = await http().post(`/api/v1/public/events/${event.slug}/orders`).send({
        items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: attendeeRoster(event.ticketTypeId, 1),
        buyerName: 'Ani', buyerEmail: 'ani@test.local', idempotencyKey: randomUUID(),
      }).expect(201);
      const door = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.COORDINATOR });
      const code = (order.tickets as { code: string }[])[0].code;
      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { code } });
      const admit = () => http().post(`/api/v1/events/${event.eventId}/tickets/${code}/admit`).set('Authorization', door.authorization);
      return { ...event, code, ticket, admit, orderId: ticket.orderId };
    };

    it('admits a ticket with its admission time, holder and linked guest', async () => {
      const event = await soldTicket();

      const { body } = await event.admit().expect(201);

      expect(body).toEqual({ code: event.code, admittedAt: expect.any(String), holderName: event.ticket.holderName, guestId: event.ticket.guestId });
      const arrival = await prisma.checkIn.findUniqueOrThrow({ where: { guestId: event.ticket.guestId! } });
      expect(arrival.arrivedAt.toISOString()).toBe(body.admittedAt);
    });

    it('refuses a second scan as already used', async () => {
      const event = await soldTicket();
      await event.admit().expect(201);

      const { body } = await event.admit().expect(400);

      expect(body.message).toBe('Ticket already used');
    });

    it('refuses a ticket whose order was cancelled, at the scanner and the guest list', async () => {
      const event = await soldTicket();
      await app.get(TicketCancellationService).cancel(event.eventId, event.orderId);

      const scanned = await event.admit().expect(400);
      const door = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.COORDINATOR });
      const listed = await http().post(checkInUrl(event.eventId, event.ticket.guestId!)).set('Authorization', door.authorization).expect(400);

      expect(scanned.body.message).toBe('Ticket order is cancelled or cancellation is in progress');
      expect(listed.body.message).toBe('Ticket order is cancelled or cancellation is in progress');
      expect(await prisma.checkIn.count()).toBe(0);
    });
  });

  /**
   * The day-of door flow the pilot script never drives: a ticket admitted,
   * a list guest checked in, a mis-scan undone and redone, and the live
   * numbers the host watches following each step.
   */
  it('runs the door on the day: admit, check in, undo, and the host’s live numbers follow', async () => {
    const event = await ticketEvent(prisma);
    const { authorization } = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.COORDINATOR });
    const base = `/api/v1/events/${event.eventId}`;
    const primary = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    await http().post(`/api/v1/invitations/${event.invitationSlug}/g/${event.primaryGuestToken}/rsvp`).send({ status: 'ATTENDING', dietary: ['vegan'] }).expect(201);
    const { body: order } = await http().post(`/api/v1/public/events/${event.slug}/orders`).send({
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 2 }], attendees: attendeeRoster(event.ticketTypeId, 2),
      buyerName: 'Ani', buyerEmail: 'ani@test.local', idempotencyKey: randomUUID(),
    }).expect(201);
    const [first] = order.tickets as { code: string }[];

    const headcount = await http().get(`${base}/headcount`).set('Authorization', authorization).expect(200);
    const catering = await http().get(`${base}/catering-sheet`).set('Authorization', authorization).expect(200);
    expect(headcount.body.attending).toBe(3);
    expect(catering.body).toMatchObject({ covers: 3, requirements: [expect.objectContaining({ key: 'vegan', count: 1 })] });

    await http().post(`${base}/tickets/${first.code}/admit`).set('Authorization', authorization).expect(201);
    await http().post(`${base}/tickets/${first.code}/admit`).set('Authorization', authorization).expect(400);
    const arrival = await http().post(checkInUrl(event.eventId, primary.id)).set('Authorization', authorization).expect(201);
    expect(arrival.body).toMatchObject({ name: 'Primary Guest', wasExpected: true });
    await http().post(checkInUrl(event.eventId, primary.id)).set('Authorization', authorization).expect(409);
    await http().delete(checkInUrl(event.eventId, primary.id)).set('Authorization', authorization).expect(200);

    const midway = await http().get(`${base}/arrivals`).set('Authorization', authorization).expect(200);
    expect(midway.body).toMatchObject({ expected: 3, arrived: 1, stillToCome: 2, unexpected: 0 });

    await http().post(checkInUrl(event.eventId, primary.id)).set('Authorization', authorization).expect(201);
    const after = await http().get(`${base}/arrivals`).set('Authorization', authorization).expect(200);
    expect(after.body).toMatchObject({ expected: 3, arrived: 2, stillToCome: 1, unexpected: 0 });
    expect((after.body.recent as { name: string }[]).map((entry) => entry.name)).toContain('Primary Guest');
  });
});
