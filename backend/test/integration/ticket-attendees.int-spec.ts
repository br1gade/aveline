import { DesignService } from '../../src/modules/design/design.service';
import { TicketSetupService } from '../../src/modules/ticketing/ticket-setup.service';
import { CacheService } from '../../src/infra/cache/cache.service';
import { AttendancePolicyService } from '../../src/modules/events/attendance-policy.service';
import { VenuesService } from '../../src/modules/design/venues.service';
import { PublicEventsService } from '../../src/modules/public-events/public-events.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { eraseSubject } from '../../src/modules/privacy/erasure';
import { exportAttendees } from '../../src/modules/ticketing/attendee-privacy';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { attendeeRoster, ticketEvent, ticketServices } from '../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Named ticket attendees (integration)', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  it('issues one guest and ticket per named person without treating a buyer as every attendee', async () => {
    const event = await ticketEvent(prisma);
    await prisma.event.update({ where: { id: event.eventId }, data: { defaultLocale: 'en' } });
    const { ticketing } = ticketServices(prisma);
    const dto = Object.assign({
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 2 }], buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
    }, { attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna', email: 'anna@test.local' }, { ticketTypeId: event.ticketTypeId, firstName: 'Davit' }] });
    const order = await ticketing.createOrder(event.slug, dto);
    const tickets = await prisma.ticket.findMany({ where: { orderId: order.orderId }, include: { guest: { include: { rsvp: true } } } });
    expect(await prisma.ticketOrder.findUnique({ where: { id: order.orderId } })).toMatchObject({ locale: 'en' });
    expect(tickets.map((ticket) => ticket.holderName).sort()).toEqual(['Anna', 'Davit']);
    expect(tickets.every((ticket) => ticket.guest?.rsvp?.status === 'ATTENDING')).toBe(true);
    expect(new Set(tickets.map((ticket) => ticket.guest?.householdId)).size).toBe(2);
    expect(tickets.find((ticket) => ticket.holderName === 'Davit')?.guest?.email).toBeNull();
    expect(await prisma.guest.count({ where: { eventId: event.eventId } })).toBe(3);
  });
  it('returns localized checkout questions and venue IDs while hiding internal venues', async () => {
    const event = await ticketEvent(prisma);
    await prisma.event.update({ where: { id: event.eventId }, data: { locales: ['en', 'ru', 'fr', 'hy'] } });
    await prisma.venue.create({ data: { eventId: event.eventId, role: 'PREPARATION', name: 'Internal', address: 'Private' } });
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { eventId: event.eventId } });
    await prisma.rsvpQuestion.create({ data: { invitationId: invitation.id, type: 'TEXT', prompt: { en: 'Meal?', ru: 'Меню?', fr: 'Repas?', hy: 'Ճա՞շ' } } });
    const service = new PublicEventsService(prisma as unknown as PrismaService);
    const page = await service.findBySlug(event.slug, 'fr');
    expect(page).toMatchObject({ checkout: { attendanceMode: 'EVENT_WIDE', attendanceRevision: 1,
      questions: [{ prompt: 'Repas?' }], venues: [{ name: 'Fixture Hall', id: expect.any(String) as string }] } });
    expect(page.venues).toHaveLength(1);
  });

  it('erases the attendee independently of the buyer and cannot resurrect a reserved roster at settlement', async () => {
    const event = await ticketEvent(prisma);
    await prisma.ticketType.update({ where: { id: event.ticketTypeId }, data: { priceMinor: 100n } });
    const { ticketing, fulfilment } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(), provider: 'FAKE',
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna', email: 'anna@test.local', dietary: ['vegan'] }] });
    expect(await exportAttendees(prisma, 'anna@test.local')).toHaveLength(1);
    expect(await exportAttendees(prisma, 'buyer@test.local')).toHaveLength(0);
    await prisma.$transaction((tx) => eraseSubject(tx, 'anna@test.local', new Date()));
    await fulfilment.markPaid(order.orderId);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId }, include: { guest: { include: { rsvp: true } } } });
    expect(ticket.guest).toMatchObject({ firstName: 'Removed', email: null, rsvp: { dietary: [] }, anonymizedAt: expect.any(Date) as Date });
    expect(await prisma.ticketOrder.findUnique({ where: { id: order.orderId } })).toMatchObject({ buyerName: 'Buyer' });
  });

  it('rolls back the entire roster, inventory and promo intent when a person has invalid answers', async () => {
    const event = await ticketEvent(prisma);
    const { ticketing } = ticketServices(prisma);
    await expect(ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 2 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna' }] })).rejects.toThrow('exactly match');
    await expect(ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna', locale: 'zz' }] })).rejects.toThrow('locale');
    expect(await prisma.ticketOrder.count()).toBe(0);
    expect(await prisma.orderAttendee.count()).toBe(0);
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: event.ticketTypeId } })).quantityReserved).toBe(0);
  });

  it('settles mixed types once under concurrent retries, grouping only explicitly named households', async () => {
    const event = await ticketEvent(prisma);
    const vip = await prisma.ticketType.create({ data: { eventId: event.eventId, priceMinor: 0n, quantityTotal: 2 } });
    const { ticketing } = ticketServices(prisma);
    const dto = { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 2 }, { ticketTypeId: vip.id, quantity: 1 }],
      attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna', householdKey: 'family' },
        { ticketTypeId: vip.id, firstName: 'Davit', householdKey: 'family' }, { ticketTypeId: event.ticketTypeId, firstName: 'Anna' }] };
    const orders = await Promise.all([ticketing.createOrder(event.slug, dto), ticketing.createOrder(event.slug, dto)]);
    expect(orders[0].orderId).toBe(orders[1].orderId);
    await Promise.all([ticketing.markPaid(orders[0].orderId), ticketing.markPaid(orders[0].orderId)]);
    const retried = await ticketing.createOrder(event.slug, dto);
    expect(retried.tickets).toHaveLength(3);
    expect(await prisma.ticket.count()).toBe(3);
    expect(await prisma.guest.count({ where: { eventId: event.eventId } })).toBe(4);
    const households = await prisma.household.findMany({ where: { eventId: event.eventId, id: { not: event.householdId } } });
    expect(households.map((row) => row.seatsAllotted).sort()).toEqual([1, 2]);
    await expect(ticketing.createOrder(event.slug, { ...dto, attendees: dto.attendees.map((person) => ({ ...person, firstName: 'Changed' })) })).rejects.toThrow('another checkout intent');
  });

  const venueMode = async () => {
    const event = await ticketEvent(prisma);
    const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;
    const policies = new AttendancePolicyService(prisma as unknown as PrismaService, cache);
    const preview = await policies.preview(event.eventId, 'PER_VENUE');
    await policies.change(event.eventId, { ...preview.request, transitionId: randomUUID() });
    const venues = await prisma.venue.findMany({ where: { eventId: event.eventId } });
    return { ...event, policies, cache, venue: venues[0] };
  };

  it('collects per-person venue answers and cancellation releases seats and declines every venue', async () => {
    const event = await venueMode();
    const other = await prisma.venue.create({ data: { eventId: event.eventId, role: 'CEREMONY', name: 'Church', address: 'Test' } });
    const { ticketing, cancellation } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(), attendanceRevision: 2,
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna', venueAttendance: [{ venueId: event.venue.id, status: 'ATTENDING' }] }] });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId } });
    const table = await prisma.table.create({ data: { eventId: event.eventId, venueId: event.venue.id, name: 'Table', capacity: 2 } });
    await prisma.seat.create({ data: { guestId: ticket.guestId!, tableId: table.id } });
    const before = await prisma.attendanceResponse.findMany({ where: { guestId: ticket.guestId! } });
    expect(before.map((row) => [row.venueId, row.status])).toEqual([[event.venue.id, 'ATTENDING']]);
    await cancellation.cancel(event.eventId, order.orderId);
    expect(await prisma.seat.count({ where: { guestId: ticket.guestId! } })).toBe(0);
    expect(await prisma.seatRelease.count({ where: { guestId: ticket.guestId! } })).toBe(1);
    const responses = await prisma.attendanceResponse.findMany({ where: { guestId: ticket.guestId! }, orderBy: { venueId: 'asc' } });
    expect(responses.map((row) => [row.venueId, row.status])).toEqual([event.venue.id, other.id].sort().map((id) => [id, 'DECLINED']));
  });

  it('keeps pending orders outside the guest graph and requires fresh answers after a policy change', async () => {
    const event = await ticketEvent(prisma);
    await prisma.ticketType.update({ where: { id: event.ticketTypeId }, data: { priceMinor: 100n } });
    const { ticketing, fulfilment } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', provider: 'FAKE', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: attendeeRoster(event.ticketTypeId, 1) });
    expect(await prisma.guest.count({ where: { eventId: event.eventId } })).toBe(1);
    await fulfilment.expire(order.orderId);
    expect(await prisma.guest.count({ where: { eventId: event.eventId } })).toBe(1);
    const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;
    const policies = new AttendancePolicyService(prisma as unknown as PrismaService, cache);
    const preview = await policies.preview(event.eventId, 'PER_VENUE');
    await policies.change(event.eventId, { ...preview.request, transitionId: randomUUID() });
    await fulfilment.issueLate(order.orderId);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId }, include: { guest: { include: { rsvp: true } } } });
    expect(ticket.guest?.rsvp?.status).toBe('PENDING');
    expect(await prisma.attendanceResponse.count({ where: { guestId: ticket.guestId! } })).toBe(0);
    expect(await prisma.orderAttendee.findFirst({ where: { orderId: order.orderId } })).toMatchObject({ attendanceRevision: 1, status: 'ATTENDING' });
  });

  it('refuses missing venue choices and stale checkout revisions without taking inventory', async () => {
    const event = await venueMode();
    const { ticketing } = ticketServices(prisma);
    const dto = { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: attendeeRoster(event.ticketTypeId, 1) };
    await expect(ticketing.createOrder(event.slug, dto)).rejects.toThrow('attendanceRevision');
    await expect(ticketing.createOrder(event.slug, { ...dto, attendanceRevision: 2 })).rejects.toThrow('venueAttendance');
    expect(await prisma.ticketOrder.count()).toBe(0);
  });

  it('preserves venue choices captured by an unsettled checkout when a host hides a venue', async () => {
    const event = await venueMode();
    await prisma.ticketType.update({ where: { id: event.ticketTypeId }, data: { priceMinor: 100n } });
    const { ticketing } = ticketServices(prisma);
    await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', provider: 'FAKE', idempotencyKey: randomUUID(), attendanceRevision: 2,
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna', venueAttendance: [{ venueId: event.venue.id, status: 'ATTENDING' }] }] });
    const venues = new VenuesService(prisma as unknown as PrismaService, event.cache);
    await expect(venues.update(event.eventId, event.venue.id, { role: 'PREPARATION' })).rejects.toThrow('checkout choices');
  });

  it('keeps a ticket type referenced by an expired roster and asks the host to deactivate it', async () => {
    const event = await ticketEvent(prisma);
    await prisma.ticketType.update({ where: { id: event.ticketTypeId }, data: { priceMinor: 100n } });
    const { ticketing, fulfilment } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', provider: 'FAKE', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: attendeeRoster(event.ticketTypeId, 1) });
    await fulfilment.expire(order.orderId);
    const setup = new TicketSetupService(prisma as unknown as PrismaService);
    await expect(setup.deleteTicketType(event.eventId, event.ticketTypeId)).rejects.toThrow('deactivate');
  });

  it('protects custom answers captured by pending checkout against question deletion or shape changes', async () => {
    const event = await ticketEvent(prisma);
    await prisma.ticketType.update({ where: { id: event.ticketTypeId }, data: { priceMinor: 100n } });
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { eventId: event.eventId } });
    const question = await prisma.rsvpQuestion.create({ data: { invitationId: invitation.id, type: 'TEXT', prompt: { en: 'Meal?' } } });
    const { ticketing, fulfilment } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', provider: 'FAKE', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna', answers: [{ questionId: question.id, value: 'Fish' }] }] });
    const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;
    const design = new DesignService(prisma as unknown as PrismaService, cache);
    await expect(design.removeQuestion(event.invitationSlug, question.id)).rejects.toThrow('answered');
    await expect(design.updateQuestion(event.invitationSlug, question.id, { type: 'BOOLEAN' })).rejects.toThrow();
    await fulfilment.markPaid(order.orderId);
    expect(await prisma.rsvpAnswer.findFirst({ where: { questionId: question.id } })).toMatchObject({ value: 'Fish' });
  });

  it('erases a buyer without erasing the separate attendees they purchased for', async () => {
    const event = await ticketEvent(prisma);
    const { ticketing } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna', email: 'anna@test.local', dietary: ['vegan'] }] });
    await prisma.$transaction((tx) => eraseSubject(tx, 'buyer@test.local', new Date()));
    const person = await prisma.orderAttendee.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(person).toMatchObject({ firstName: 'Anna', email: 'anna@test.local', dietary: ['vegan'], erasedAt: null });
    expect(await prisma.ticket.findFirst({ where: { orderId: order.orderId }, include: { guest: true } })).toMatchObject({ holderName: 'Anna', guest: { firstName: 'Anna' } });
  });

});
