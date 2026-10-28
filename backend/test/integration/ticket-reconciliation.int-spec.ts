import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TicketAttendeesService } from '../../src/modules/ticketing/ticket-attendees.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ticketEvent, ticketServices, attendeeRoster } from '../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Host ticket reconciliation (integration)', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  it('explicitly links an invited guest, preserves their answers and archives the checkout person', async () => {
    const event = await ticketEvent(prisma);
    const invited = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    await prisma.rsvp.update({ where: { guestId: invited.id }, data: { dietary: ['vegetarian'] } });
    const { ticketing } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: attendeeRoster(event.ticketTypeId, 1) });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId } });
    const service = new TicketAttendeesService(prisma as unknown as PrismaService);
    await service.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: ticket.guestId!, keepExistingAnswers: true });
    expect(await prisma.guest.count({ where: { eventId: event.eventId } })).toBe(1);
    expect(await prisma.ticket.findUnique({ where: { id: ticket.id } })).toMatchObject({ guestId: invited.id });
    expect(await prisma.rsvp.findUnique({ where: { guestId: invited.id } })).toMatchObject({ dietary: ['vegetarian'] });
    const person = await prisma.orderAttendee.findUniqueOrThrow({ where: { id: ticket.attendeeId! } });
    expect(person.linkedSourceSnapshot).toMatchObject({ firstName: 'Attendee 1' });
    await expect(service.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: ticket.guestId!, keepExistingAnswers: true })).resolves.toMatchObject({ guestId: invited.id });
  });

  it('registers a supplied legacy attendee without guessing identity or issuing another ticket', async () => {
    const event = await ticketEvent(prisma);
    const order = await prisma.ticketOrder.create({ data: { eventId: event.eventId, buyerName: 'Buyer', buyerEmail: 'buyer@test.local', totalMinor: 0n,
      currency: 'AMD', status: 'PAID', idempotencyKey: randomUUID(), accessToken: randomUUID() } });
    const ticket = await prisma.ticket.create({ data: { eventId: event.eventId, orderId: order.id, ticketTypeId: event.ticketTypeId, code: randomUUID(), holderName: 'Buyer' } });
    const service = new TicketAttendeesService(prisma as unknown as PrismaService);
    await service.register(event.eventId, ticket.id, { attendee: { firstName: 'Actual', ticketTypeId: event.ticketTypeId } });
    const current = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { guest: true } });
    expect(current.guest).toMatchObject({ firstName: 'Actual', email: null });
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(1);
    await expect(service.register(event.eventId, ticket.id, { attendee: { firstName: 'Different', ticketTypeId: event.ticketTypeId } })).rejects.toThrow('already');
  });
  it('refuses a target from another event and an already-ticketed target without losing either source', async () => {
    const event = await ticketEvent(prisma);
    const other = await ticketEvent(prisma);
    const outsider = await prisma.guest.findUniqueOrThrow({ where: { token: other.primaryGuestToken } });
    const { ticketing } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 2 }], attendees: attendeeRoster(event.ticketTypeId, 2) });
    const tickets = await prisma.ticket.findMany({ where: { orderId: order.orderId } });
    const service = new TicketAttendeesService(prisma as unknown as PrismaService);
    const request = { expectedGuestId: tickets[0].guestId!, keepExistingAnswers: true as const };
    await expect(service.linkGuest(event.eventId, tickets[0].id, { ...request, guestId: outsider.id })).rejects.toThrow('not found');
    await expect(service.linkGuest(event.eventId, tickets[0].id, { ...request, guestId: tickets[1].guestId! })).rejects.toThrow('already has');
    expect(await prisma.guest.count({ where: { eventId: event.eventId } })).toBe(3);
  });

  it('refuses merging a seated checkout guest until its seating is explicitly resolved', async () => {
    const event = await ticketEvent(prisma);
    const target = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const { ticketing } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: attendeeRoster(event.ticketTypeId, 1) });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId } });
    const table = await prisma.table.create({ data: { eventId: event.eventId, name: 'Table', capacity: 2 } });
    await prisma.seat.create({ data: { guestId: ticket.guestId!, tableId: table.id } });
    const service = new TicketAttendeesService(prisma as unknown as PrismaService);
    await expect(service.linkGuest(event.eventId, ticket.id, { guestId: target.id, expectedGuestId: ticket.guestId!, keepExistingAnswers: true })).rejects.toThrow('seats');
    expect(await prisma.seat.count()).toBe(1);
    expect(await prisma.guest.findUnique({ where: { id: ticket.guestId! } })).not.toBeNull();
  });

  it('preserves a known legacy admission timestamp while linking to an invited person', async () => {
    const event = await ticketEvent(prisma);
    const target = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const order = await prisma.ticketOrder.create({ data: { eventId: event.eventId, buyerName: 'Buyer', buyerEmail: 'buyer@test.local', totalMinor: 0n,
      currency: 'AMD', status: 'PAID', idempotencyKey: randomUUID(), accessToken: randomUUID() } });
    const usedAt = new Date('2026-10-01T12:00:00Z');
    const ticket = await prisma.ticket.create({ data: { eventId: event.eventId, orderId: order.id, ticketTypeId: event.ticketTypeId, code: randomUUID(), status: 'USED', usedAt } });
    const service = new TicketAttendeesService(prisma as unknown as PrismaService);
    await service.linkGuest(event.eventId, ticket.id, { guestId: target.id, expectedGuestId: null, keepExistingAnswers: true });
    expect(await prisma.checkIn.findUnique({ where: { guestId: target.id } })).toMatchObject({ arrivedAt: usedAt });
    expect(await prisma.ticket.findUnique({ where: { id: ticket.id } })).toMatchObject({ status: 'USED', usedAt, guestId: target.id, holderName: 'Primary Guest' });
  });

  it('promotes a remaining household member without leaving an extra plus-one allowance after reconciliation', async () => {
    const event = await ticketEvent(prisma);
    const target = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const { ticketing } = ticketServices(prisma);
    await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 2 }], attendees: attendeeRoster(event.ticketTypeId, 2).map((person) => ({ ...person, householdKey: 'family' })) });
    const source = await prisma.guest.findFirstOrThrow({ where: { eventId: event.eventId, isPrimary: true, id: { not: target.id } }, include: { ticket: true } });
    const service = new TicketAttendeesService(prisma as unknown as PrismaService);
    await service.linkGuest(event.eventId, source.ticket!.id, { guestId: target.id, expectedGuestId: source.id, keepExistingAnswers: true });
    expect(await prisma.household.findUnique({ where: { id: source.householdId }, include: { guests: true } })).toMatchObject({ seatsAllotted: 1, guests: [{ isPrimary: true }] });
  });

});
