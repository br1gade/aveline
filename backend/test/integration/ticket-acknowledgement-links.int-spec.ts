import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CommunicationsService, StillWanted } from '../../src/modules/communications/communications.service';
import { TicketAcknowledgementInviter } from '../../src/modules/guest-contributions/ticket-acknowledgement-inviter';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Ticket attendee acknowledgement links (integration)', () => {
  let prisma: PrismaClient; let inviter: TicketAcknowledgementInviter; let enqueueMany: jest.Mock; let check: StillWanted;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(async () => {
    await resetTestDatabase(); enqueueMany = jest.fn().mockResolvedValue(new Map());
    inviter = new TicketAcknowledgementInviter(prisma as unknown as PrismaService, {
      enqueueMany, checkBeforeSending: (_key: string, wanted: StillWanted) => { check = wanted; },
    } as unknown as CommunicationsService, new ConfigService({ PUBLIC_APP_URL: 'https://app.test' }));
    inviter.onModuleInit();
  });
  afterAll(() => disconnectTestDatabase());
  const setup = async () => {
    const event = await seedEvent(prisma);
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
    await prisma.rsvpQuestion.create({ data: { invitationId: invitation.id, type: 'SIGNATURE', required: true, prompt: { en: 'Rules' } } });
    const guest = await prisma.guest.update({ where: { token: event.primaryGuestToken }, data: { email: 'attendee@test.local' } });
    const type = await prisma.ticketType.create({ data: { eventId: event.eventId, priceMinor: 0n, quantityTotal: 1 } });
    const order = await prisma.ticketOrder.create({ data: { eventId: event.eventId, buyerName: 'Buyer', buyerEmail: 'buyer@test.local', totalMinor: 0n, status: 'PAID', accessToken: randomUUID(), idempotencyKey: randomUUID() } });
    const ticket = await prisma.ticket.create({ data: { eventId: event.eventId, ticketTypeId: type.id, orderId: order.id, guestId: guest.id, code: randomUUID() } });
    return { ...event, guest, order, ticket };
  };
  it('queues the personal invitation to each attendee rather than the order buyer', async () => {
    const event = await setup(); await inviter.sendMissing();
    const [message] = enqueueMany.mock.calls[0][0];
    expect(message).toMatchObject({ templateKey: 'ticket.acknowledgement', guestId: event.guest.id, toAddress: 'attendee@test.local', channel: 'EMAIL',
      dedupeKey: `ticket-ack:${event.ticket.id}:${event.guest.id}`, variables: { link: `https://app.test/invitations/${event.slug}/g/${event.guest.token}` } });
    expect(JSON.stringify(message)).not.toContain(event.order.accessToken);
  });
  it.each(['cancelled', 'expired', 'erased', 'no contact'] as const)('does not queue links for %s attendees', async (state) => {
    const event = await setup();
    if (state === 'cancelled') await prisma.ticketOrder.update({ where: { id: event.order.id }, data: { status: 'CANCELLED' } });
    if (state === 'expired') await prisma.invitation.update({ where: { slug: event.slug }, data: { expiresAt: new Date(0) } });
    if (state === 'erased') await prisma.guest.update({ where: { id: event.guest.id }, data: { anonymizedAt: new Date() } });
    if (state === 'no contact') await prisma.guest.update({ where: { id: event.guest.id }, data: { email: null } });
    await inviter.sendMissing(); expect(enqueueMany).not.toHaveBeenCalled();
  });
  it('rechecks the recipient and ticket before dispatch and recovers missing notices without duplicating recorded ones', async () => {
    const event = await setup(); await inviter.sendMissing();
    const [message] = enqueueMany.mock.calls[0][0];
    expect(await check({ guestId: event.guest.id, eventId: event.eventId, toAddress: event.guest.email! })).toBe(true);
    await prisma.guest.update({ where: { id: event.guest.id }, data: { email: 'changed@test.local' } });
    expect(await check({ guestId: event.guest.id, eventId: event.eventId, toAddress: event.guest.email! })).toBe(false);
    await prisma.message.create({ data: { organizationId: message.organizationId, eventId: event.eventId, guestId: event.guest.id, channel: 'EMAIL',
      templateKey: 'ticket.acknowledgement', toAddress: 'attendee@test.local', body: 'private link', dedupeKey: message.dedupeKey } });
    enqueueMany.mockClear(); await inviter.sendMissing(); expect(enqueueMany).not.toHaveBeenCalled();
  });
});
