import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MessageChannel, PrismaClient, RsvpStatus, SuppressionReason } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { addressFingerprint } from '../../../src/modules/communications/address-form';
import { SuppressionService } from '../../../src/modules/communications/suppression.service';
import { CheckInService } from '../../../src/modules/guests/check-in.service';
import { GuestManagementService } from '../../../src/modules/guests/guest-management.service';
import { GuestImportService } from '../../../src/modules/guests/import/guest-import.service';
import { HOUSEHOLDS_PER_BATCH } from '../../../src/modules/guests/import/household-import';
import { RsvpConfirmerService } from '../../../src/modules/invitations/sending/rsvp-confirmer.service';
import { HostRsvpService } from '../../../src/modules/rsvp/host-rsvp.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { holdTransaction, untilSomeoneWaitsOnALock } from '../../fixtures/areas/guest-list.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { ticketEvent, ticketServices } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The guest list's rules that only Postgres can prove: event scoping on every
 * edit, the locks that serialise moves, removals, check-ins and erasure, and
 * what a failed import batch leaves behind.
 */
describe('Guest list (integration)', () => {
  let prisma: PrismaClient;
  let database: PrismaService;
  let guests: GuestManagementService;

  beforeAll(() => {
    prisma = testPrisma();
    database = prisma as unknown as PrismaService;
    guests = new GuestManagementService(database);
  });
  beforeEach(() => resetTestDatabase());
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => disconnectTestDatabase());

  const guestIn = (eventId: string, householdId: string, firstName: string, isPrimary = false) =>
    prisma.guest.create({
      data: { eventId, householdId, firstName, isPrimary, token: randomUUID().replace(/-/g, ''), rsvp: { create: {} } },
    });

  const householdOf = async (eventId: string, name: string, members: string[], seatsAllotted = 4) => {
    const household = await prisma.household.create({ data: { eventId, name, seatsAllotted } });
    const people = [];
    for (const [index, firstName] of members.entries()) people.push(await guestIn(eventId, household.id, firstName, index === 0));
    return { id: household.id, people };
  };

  describe('an import batch that fails to save', () => {
    const fileOf = (households: number) => {
      const rows = Array.from({ length: households }, (_, index) => `G${index},H${index}`);
      return Buffer.from(['First Name,Household', ...rows, `G${households - 1}b,H${households - 1}`].join('\n'));
    };

    const failingSecondBatch = () => {
      const original = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>;
      let calls = 0;
      jest.spyOn(prisma, '$transaction').mockImplementation(((...args: unknown[]) => {
        calls += 1;
        if (calls === 2) return Promise.reject(new Error('duplicate key value violates unique constraint "guests_token_key" (secret-token)'));
        return original(...args);
      }));
    };

    it('reports every row of that batch with a safe message and keeps the other batches', async () => {
      const { eventId } = await seedEvent(prisma);
      failingSecondBatch();

      const result = await new GuestImportService(database).importCsv(eventId, 'big.csv', fileOf(HOUSEHOLDS_PER_BATCH + 1));

      // Row 1 is the header, so the first batch's households fill rows 2..N+1.
      const last = HOUSEHOLDS_PER_BATCH;
      expect(result).toMatchObject({ status: 'PARTIAL', rowsImported: HOUSEHOLDS_PER_BATCH, rowsFailed: 2 });
      expect(result.errors).toEqual([
        { row: last + 2, message: `Could not save G${last}: an unexpected error; try the row again` },
        { row: last + 3, message: `Could not save G${last}b: an unexpected error; try the row again` },
      ]);
      expect(await prisma.guest.count({ where: { eventId, firstName: { startsWith: 'G' } } })).toBe(HOUSEHOLDS_PER_BATCH);
      expect(await prisma.household.count({ where: { eventId, name: `H${last}` } })).toBe(0);
    });

    it('keeps the database error out of the stored import history', async () => {
      const { eventId } = await seedEvent(prisma);
      failingSecondBatch();

      const { importId } = await new GuestImportService(database).importCsv(eventId, 'big.csv', fileOf(HOUSEHOLDS_PER_BATCH + 1));

      const stored = await prisma.guestImport.findUniqueOrThrow({ where: { id: importId } });
      expect(stored.status).toBe('PARTIAL');
      expect(JSON.stringify(stored.errors)).not.toMatch(/duplicate key|secret-token/);
    });
  });

  describe('edits addressed to another event', () => {
    const twoEvents = async () => {
      const own = await seedEvent(prisma, { seatsAllotted: 4 });
      const other = await seedEvent(prisma, { seatsAllotted: 4 });
      const ownGuest = await prisma.guest.findUniqueOrThrow({ where: { token: own.primaryGuestToken } });
      const otherGuest = await prisma.guest.findUniqueOrThrow({ where: { token: other.primaryGuestToken } });
      return { own, other, ownGuest, otherGuest };
    };

    it('404s removing a guest from another event, and keeps them', async () => {
      const { own, otherGuest } = await twoEvents();

      await expect(guests.removeGuest(own.eventId, otherGuest.id)).rejects.toBeInstanceOf(NotFoundException);

      expect(await prisma.guest.count({ where: { id: otherGuest.id } })).toBe(1);
    });

    it('404s renaming a household from another event, and leaves it as it was', async () => {
      const { own, other } = await twoEvents();

      await expect(guests.updateHousehold(own.eventId, other.householdId, { name: 'Taken', seatsAllotted: 9 })).rejects.toBeInstanceOf(NotFoundException);

      expect(await prisma.household.findUniqueOrThrow({ where: { id: other.householdId } })).toMatchObject({ name: 'Fixture Household', seatsAllotted: 4 });
    });

    it('404s moving a guest into a household on another event, and moves nobody', async () => {
      const { own, other, ownGuest } = await twoEvents();

      await expect(guests.updateGuest(own.eventId, ownGuest.id, { householdId: other.householdId })).rejects.toBeInstanceOf(NotFoundException);

      expect(await prisma.guest.findUniqueOrThrow({ where: { id: ownGuest.id } })).toMatchObject({ householdId: own.householdId, isPrimary: true });
      expect(await prisma.guest.count({ where: { householdId: other.householdId } })).toBe(1);
    });
  });

  describe('moving concurrently', () => {
    // Eight pairs at once: each pair moves one guest A→B and one B→A, which
    // deadlocks if the two lock the households in opposite orders.
    it('completes opposite-direction moves without a deadlock, each household keeping one primary', async () => {
      const { eventId } = await seedEvent(prisma);
      const pairs = [];
      for (let index = 0; index < 8; index += 1) {
        pairs.push([await householdOf(eventId, `A${index}`, ['a1', 'a2']), await householdOf(eventId, `B${index}`, ['b1', 'b2'])]);
      }

      const results = await Promise.allSettled(pairs.flatMap(([a, b]) => [
        guests.updateGuest(eventId, a.people[0].id, { householdId: b.id }),
        guests.updateGuest(eventId, b.people[0].id, { householdId: a.id }),
      ]));

      expect(results.filter((result) => result.status === 'rejected').map((result) => String((result).reason))).toEqual([]);
      for (const household of pairs.flat()) {
        const members = await prisma.guest.findMany({ where: { householdId: household.id }, select: { isPrimary: true } });
        expect(members).toHaveLength(2);
        expect(members.filter((member) => member.isPrimary)).toHaveLength(1);
      }
    });

    it('409s an edit to a guest who was moved to another household while it waited', async () => {
      const { eventId } = await seedEvent(prisma);
      const a = await householdOf(eventId, 'A', ['Ani']);
      const b = await householdOf(eventId, 'B', ['Bella']);
      const ani = a.people[0];
      const mover = await holdTransaction(prisma, (tx) => tx.guest.update({ where: { id: ani.id }, data: { householdId: b.id, isPrimary: false } }));

      const edit = guests.updateGuest(eventId, ani.id, { firstName: 'Anahit' });
      const settled = Promise.allSettled([edit]);
      await untilSomeoneWaitsOnALock(prisma);
      mover.release();
      await mover.done;

      const [outcome] = await settled;
      expect(outcome.status).toBe('rejected');
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(String((outcome as PromiseRejectedResult).reason)).toMatch(/moved to another household just now/);
      expect(await prisma.guest.findUniqueOrThrow({ where: { id: ani.id } })).toMatchObject({ firstName: 'Ani', householdId: b.id });
    });
  });

  describe('removing a ticket holder', () => {
    const ticketHolder = async () => {
      const event = await ticketEvent(prisma);
      const services = ticketServices(prisma);
      const order = await services.ticketing.createOrder(event.slug, {
        buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
        items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }],
        attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna' }],
      });
      const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId } });
      return { event, services, orderId: order.orderId, guestId: ticket.guestId as string };
    };

    it('refuses to remove a guest linked to a ticket, and keeps them', async () => {
      const { event, guestId } = await ticketHolder();

      const refusal = guests.removeGuest(event.eventId, guestId);

      await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
      await expect(refusal).rejects.toThrow(/linked to a ticket/);
      expect(await prisma.guest.count({ where: { id: guestId } })).toBe(1);
    });

    it('still refuses once the order is cancelled', async () => {
      const { event, services, orderId, guestId } = await ticketHolder();
      await services.cancellation.cancel(event.eventId, orderId);
      expect(await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'CANCELLED' });

      await expect(guests.removeGuest(event.eventId, guestId)).rejects.toThrow(/linked to a ticket/);
      expect(await prisma.guest.count({ where: { id: guestId } })).toBe(1);
    });
  });

  // Eight fresh guests: with one, the two often run one after the other and an
  // unlocked version would pass.
  it('lets either a removal or a simultaneous check-in win, never both', async () => {
    const { eventId } = await seedEvent(prisma);
    const checkIn = new CheckInService(database);
    const racers = [];
    for (let index = 0; index < 8; index += 1) racers.push((await householdOf(eventId, `R${index}`, [`Racer ${index}`])).people[0]);

    const outcomes = await Promise.all(racers.map(async (guest) => {
      const [removal, arrival] = await Promise.allSettled([guests.removeGuest(eventId, guest.id), checkIn.checkIn(eventId, guest.id)]);
      return { guestId: guest.id, removal, arrival };
    }));

    for (const { guestId, removal, arrival } of outcomes) {
      expect([removal.status, arrival.status].sort()).toEqual(['fulfilled', 'rejected']);
      const isRemoved = removal.status === 'fulfilled';
      expect(await prisma.guest.count({ where: { id: guestId } })).toBe(isRemoved ? 0 : 1);
      expect(await prisma.checkIn.count({ where: { guestId } })).toBe(isRemoved ? 0 : 1);
      const refusal = isRemoved ? (arrival as PromiseRejectedResult).reason : (removal).reason;
      expect(refusal).toBeInstanceOf(isRemoved ? NotFoundException : BadRequestException);
      expect(String(refusal)).toMatch(isRemoved ? /not on this event/ : /checked in/);
    }
  });

  it('refuses a host answer for a guest whose erasure commits while the answer waits', async () => {
    const { eventId, primaryGuestToken } = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken } });
    const host = new HostRsvpService(database, { confirm: jest.fn() } as unknown as RsvpConfirmerService);
    const erasure = await holdTransaction(prisma, (tx) =>
      tx.guest.update({ where: { id: guest.id }, data: { anonymizedAt: new Date(), firstName: 'Erased', lastName: null } }));

    const settled = Promise.allSettled([host.record(eventId, guest.id, { status: RsvpStatus.ATTENDING, dietaryNotes: 'nuts' })]);
    await untilSomeoneWaitsOnALock(prisma);
    erasure.release();
    await erasure.done;

    const [outcome] = await settled;
    expect(outcome.status).toBe('rejected');
    expect(String((outcome as PromiseRejectedResult).reason)).toMatch(/erased/);
    expect(await prisma.rsvp.findUniqueOrThrow({ where: { guestId: guest.id } })).toMatchObject({ status: RsvpStatus.PENDING, dietaryNotes: null });
  });

  describe("an erased person's suppression", () => {
    const erasedRow = (organizationId: string, email: string) =>
      prisma.suppression.create({
        data: { organizationId, channel: MessageChannel.EMAIL, address: addressFingerprint(MessageChannel.EMAIL, email), reason: SuppressionReason.ERASED },
      });

    const organizationOf = async (eventId: string) => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).organizationId;

    it("shows the address of the organization's own guest it matches", async () => {
      const { eventId, primaryGuestToken } = await seedEvent(prisma);
      await prisma.guest.update({ where: { token: primaryGuestToken }, data: { email: 'back@test.local' } });
      const organizationId = await organizationOf(eventId);
      const row = await erasedRow(organizationId, 'back@test.local');

      expect(await new SuppressionService(database).list(organizationId)).toEqual([expect.objectContaining({ id: row.id, address: 'back@test.local' })]);
    });

    it("stays unreadable when only another organization's guest has the address", async () => {
      const own = await seedEvent(prisma);
      const other = await seedEvent(prisma);
      await prisma.guest.update({ where: { token: other.primaryGuestToken }, data: { email: 'back@test.local' } });
      const organizationId = await organizationOf(own.eventId);
      const row = await erasedRow(organizationId, 'back@test.local');

      expect(await new SuppressionService(database).list(organizationId)).toEqual([expect.objectContaining({ id: row.id, address: '[erased]' })]);
    });
  });
});
