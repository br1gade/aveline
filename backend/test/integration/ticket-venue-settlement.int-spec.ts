import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../../src/infra/cache/cache.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AttendancePolicyService } from '../../src/modules/events/attendance-policy.service';
import { ticketEvent, ticketServices } from '../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Venue changes during ticket settlement (integration)', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  it('leaves a newly added venue unanswered rather than copying an old decline into its summary', async () => {
    const event = await ticketEvent(prisma);
    const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;
    const policies = new AttendancePolicyService(prisma as unknown as PrismaService, cache);
    const preview = await policies.preview(event.eventId, 'PER_VENUE');
    await policies.change(event.eventId, { ...preview.request, transitionId: randomUUID() });
    const hall = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    await prisma.ticketType.update({ where: { id: event.ticketTypeId }, data: { priceMinor: 100n } });
    const { ticketing, fulfilment } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', provider: 'FAKE', idempotencyKey: randomUUID(), attendanceRevision: 2,
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna', venueAttendance: [{ venueId: hall.id, status: 'DECLINED' }] }] });
    await prisma.venue.create({ data: { eventId: event.eventId, role: 'CEREMONY', name: 'Church', address: 'Test' } });
    await fulfilment.markPaid(order.orderId);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId }, include: { guest: { include: { rsvp: true, attendanceResponses: true } } } });
    expect(ticket.guest?.rsvp?.status).toBe('PENDING');
    expect(ticket.guest?.attendanceResponses).toEqual([expect.objectContaining({ venueId: hall.id, status: 'DECLINED' })]);
  });
});
