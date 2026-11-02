import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AnalyticsService } from '../../../src/infra/analytics/analytics.service';
import { CacheService } from '../../../src/infra/cache/cache.service';
import { AttendancePolicyService } from '../../../src/modules/events/attendance-policy.service';
import { CheckInService } from '../../../src/modules/guests/check-in.service';
import { RsvpConfirmerService } from '../../../src/modules/invitations/sending/rsvp-confirmer.service';
import { OperationsService } from '../../../src/modules/operations/operations.service';
import { HostRsvpService } from '../../../src/modules/rsvp/host-rsvp.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { seedEvent } from '../../fixtures/event.fixture';
import { attendeeRoster, ticketEvent, ticketServices } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The day of the event, against real Postgres: who the headcount shows per
 * venue, and the door's guarantees — one arrival per person, one admission
 * per ticket, and nothing admitted while its order is being cancelled.
 */
describe('Operations and the door (coverage, integration)', () => {
  let prisma: PrismaClient;
  let database: PrismaService;
  beforeAll(() => {
    prisma = testPrisma();
    database = prisma as unknown as PrismaService;
  });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  const operations = () => new OperationsService(database, {} as AnalyticsService);
  const checkIns = () => new CheckInService(database);

  describe('headcount by venue', () => {
    const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;
    const confirmer = { confirm: jest.fn().mockResolvedValue(undefined) } as unknown as RsvpConfirmerService;

    const venuesFixture = async () => {
      const event = await seedEvent(prisma, { seatsAllotted: 4 });
      const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
      const hall = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
      const church = await prisma.venue.create({ data: { eventId: event.eventId, role: 'CEREMONY', name: 'Church', address: '2 Test St', sortOrder: 1 } });
      const preparation = await prisma.venue.create({ data: { eventId: event.eventId, role: 'PREPARATION', name: 'Private home', address: 'Secret', sortOrder: 2 } });
      const crew = await prisma.venue.create({ data: { eventId: event.eventId, role: 'AFTER_PARTY', name: 'Crew room', address: 'Backstage', sortOrder: 3 } });
      await prisma.timelineEntry.create({ data: { eventId: event.eventId, venueId: crew.id, isInternal: true, occursAt: new Date(), label: { en: 'Crew briefing' } } });
      return { ...event, guest, hall, church, preparation, crew };
    };

    it('lists only guest-facing venues, leaving out preparation and internal-only venues', async () => {
      const event = await venuesFixture();

      const { venues } = await operations().headcount(event.eventId);

      expect(venues.map((venue) => venue.venueId)).toEqual([event.hall.id, event.church.id]);
    });

    it('lists a venue once it has a timeline entry guests can see', async () => {
      const event = await venuesFixture();
      await prisma.timelineEntry.create({ data: { eventId: event.eventId, venueId: event.crew.id, isInternal: false, occursAt: new Date(), label: { en: 'After party' } } });

      const { venues } = await operations().headcount(event.eventId);

      expect(venues.map((venue) => venue.venueId)).toEqual([event.hall.id, event.church.id, event.crew.id]);
    });

    it('counts each guest-facing venue from its own answers under per-venue attendance', async () => {
      const event = await venuesFixture();
      const policy = new AttendancePolicyService(database, cache);
      const preview = await policy.preview(event.eventId, 'PER_VENUE');
      await policy.change(event.eventId, { ...preview.request, transitionId: randomUUID() });
      await new HostRsvpService(database, confirmer).record(event.eventId, event.guest.id, {
        attendanceRevision: 2,
        venueAttendance: [{ venueId: event.hall.id, status: 'ATTENDING' }, { venueId: event.church.id, status: 'DECLINED' }],
      });

      const { venues } = await operations().headcount(event.eventId);

      expect(venues).toEqual([
        { venueId: event.hall.id, venue: 'Fixture Hall', invited: 1, attending: 1, declined: 0, undecided: 0, pending: 0 },
        { venueId: event.church.id, venue: 'Church', invited: 1, attending: 0, declined: 1, undecided: 0, pending: 0 },
      ]);
    });
  });

  describe('checking in a list guest', () => {
    it('records one arrival when five door staff check in the same guest at once, refusing the rest with 409', async () => {
      const { eventId, primaryGuestToken } = await seedEvent(prisma);
      const guest = await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken } });
      const service = checkIns();

      const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => service.checkIn(eventId, guest.id)));

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const refusals = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      expect(refusals).toHaveLength(4);
      for (const refusal of refusals) expect(refusal.reason).toBeInstanceOf(ConflictException);
      expect(await prisma.checkIn.count({ where: { guestId: guest.id } })).toBe(1);
      expect(await service.arrivals(eventId)).toMatchObject({ arrived: 1 });
    });
  });

  describe('admitting a ticket', () => {
    const ticketFixture = async () => {
      const event = await ticketEvent(prisma);
      const services = ticketServices(prisma);
      const order = await services.ticketing.createOrder(event.slug, {
        items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: attendeeRoster(event.ticketTypeId, 1),
        buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      });
      const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId } });
      const listGuest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
      return { ...event, ...services, order, ticket, listGuest, checkIn: checkIns() };
    };

    it('admits once when four staff scan the same ticket at once, refusing the rest as already used', async () => {
      const event = await ticketFixture();

      const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => event.ticketing.admit(event.eventId, event.ticket.code)));

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const refusals = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      expect(refusals).toHaveLength(3);
      for (const refusal of refusals) {
        expect(refusal.reason).toBeInstanceOf(BadRequestException);
        expect((refusal.reason as Error).message).toBe('Ticket already used');
      }
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: event.ticket.id } })).status).toBe('USED');
      expect(await prisma.checkIn.count({ where: { guestId: event.ticket.guestId! } })).toBe(1);
    });

    it.each(['scanner', 'guest check-in'] as const)('refuses the %s while the order is frozen for cancellation, admitting nothing', async (surface) => {
      const event = await ticketFixture();
      await prisma.ticketOrder.update({ where: { id: event.order.orderId }, data: { cancellationStartedAt: new Date() } });

      const scan = surface === 'scanner'
        ? event.ticketing.admit(event.eventId, event.ticket.code)
        : event.checkIn.checkIn(event.eventId, event.ticket.guestId!);

      await expect(scan).rejects.toThrow(new BadRequestException('Ticket order is cancelled or cancellation is in progress'));
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: event.ticket.id } })).status).toBe('VALID');
      expect(await prisma.checkIn.count()).toBe(0);
    });

    it('undoes a check-in on a frozen order without restoring its ticket to valid', async () => {
      const event = await ticketFixture();
      await event.checkIn.checkIn(event.eventId, event.ticket.guestId!);
      await prisma.ticketOrder.update({ where: { id: event.order.orderId }, data: { cancellationStartedAt: new Date() } });

      await event.checkIn.undo(event.eventId, event.ticket.guestId!);

      expect(await prisma.checkIn.count({ where: { guestId: event.ticket.guestId! } })).toBe(0);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: event.ticket.id } })).status).toBe('USED');
    });

    /**
     * A host links a ticket to a list guest while a door action for that
     * guest is waiting on the event lock. The waiting action read "no ticket"
     * before the link committed and must refuse rather than act on it.
     */
    const linkWhileWaiting = async (event: Awaited<ReturnType<typeof ticketFixture>>, waiting: () => Promise<unknown>) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let isHeld!: () => void;
      const held = new Promise<void>((resolve) => (isHeld = resolve));
      const linking = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM events WHERE id = ${event.eventId} FOR UPDATE`;
        await tx.ticket.update({ where: { id: event.ticket.id }, data: { guestId: event.listGuest.id } });
        isHeld();
        await gate;
      }, { timeout: 15_000 });
      await held;
      const outcome = waiting().then(() => null, (error: unknown) => error);
      await untilSomeoneWaitsOnALock(prisma);
      release();
      await linking;
      return outcome;
    };

    it('refuses an undo that raced a ticket being linked to the guest', async () => {
      const event = await ticketFixture();
      await event.checkIn.checkIn(event.eventId, event.listGuest.id);

      const refusal = await linkWhileWaiting(event, () => event.checkIn.undo(event.eventId, event.listGuest.id));

      expect(refusal).toBeInstanceOf(ConflictException);
      expect((refusal as Error).message).toMatch(/^Ticket was linked/);
      expect(await prisma.checkIn.count({ where: { guestId: event.listGuest.id } })).toBe(1);
    });

    it('refuses a check-in that raced a ticket being linked to the guest', async () => {
      const event = await ticketFixture();

      const refusal = await linkWhileWaiting(event, () => event.checkIn.checkIn(event.eventId, event.listGuest.id));

      expect(refusal).toBeInstanceOf(ConflictException);
      expect((refusal as Error).message).toMatch(/^Ticket was linked/);
      expect(await prisma.checkIn.count()).toBe(0);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: event.ticket.id } })).status).toBe('VALID');
    });
  });
});

/** Returns once another session in this database is blocked on a lock. Bounded so a broken race fails, not hangs. */
async function untilSomeoneWaitsOnALock(prisma: PrismaClient) {
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>(Prisma.sql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`);
    if (waiting > 0) return;
  }
  throw new Error('no session ever waited on the event lock');
}
