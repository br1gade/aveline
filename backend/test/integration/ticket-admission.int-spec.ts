import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CheckInService } from '../../src/modules/guests/check-in.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { attendeeRoster, ticketEvent, ticketServices } from '../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Unified ticket and guest admission (integration)', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());
  const fixture = async () => {
    const event = await ticketEvent(prisma);
    const services = ticketServices(prisma);
    const order = await services.ticketing.createOrder(event.slug, { items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }],
      attendees: attendeeRoster(event.ticketTypeId, 1), buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID() });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId } });
    return { ...event, ...services, order, ticket, checkIn: new CheckInService(prisma as unknown as PrismaService) };
  };

  it('admits once when ticket and guest scanners race for the same person', async () => {
    const event = await fixture();
    const outcomes = await Promise.allSettled([event.ticketing.admit(event.eventId, event.ticket.code), event.checkIn.checkIn(event.eventId, event.ticket.guestId!)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const arrival = await prisma.checkIn.findUniqueOrThrow({ where: { guestId: event.ticket.guestId! } });
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: event.ticket.id } })).toMatchObject({ status: 'USED', usedAt: arrival.arrivedAt });
    expect(await event.checkIn.arrivals(event.eventId)).toMatchObject({ arrived: 1 });
  });

  it('treats guest check-in as a used ticket and refuses cancellation until an explicit undo', async () => {
    const event = await fixture();
    await event.checkIn.checkIn(event.eventId, event.ticket.guestId!);
    await expect(event.cancellation.cancel(event.eventId, event.order.orderId)).rejects.toBeInstanceOf(ConflictException);
    await event.checkIn.undo(event.eventId, event.ticket.guestId!);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: event.ticket.id } })).status).toBe('VALID');
    await event.cancellation.cancel(event.eventId, event.order.orderId);
    expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.ticket.guestId! } })).status).toBe('DECLINED');
    await expect(event.checkIn.checkIn(event.eventId, event.ticket.guestId!)).rejects.toThrow('Ticket');
  });
  it.each(['ticket', 'guest'] as const)('cannot cancel and admit concurrently through the %s surface', async (surface) => {
    const event = await fixture();
    const scan = surface === 'ticket' ? () => event.ticketing.admit(event.eventId, event.ticket.code)
      : () => event.checkIn.checkIn(event.eventId, event.ticket.guestId!);
    const outcomes = await Promise.allSettled([event.cancellation.cancel(event.eventId, event.order.orderId), scan()]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: event.ticket.id } });
    expect(await prisma.checkIn.count({ where: { guestId: event.ticket.guestId! } })).toBe(ticket.status === 'USED' ? 1 : 0);
    expect(['USED', 'VOID']).toContain(ticket.status);
  });

});
