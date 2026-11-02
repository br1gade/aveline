import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DiscountKind, MessageChannel, PaymentProvider, PrismaClient, TicketOrderStatus } from '@prisma/client';
import { ConsoleTransport } from '../../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { SuppressionService } from '../../../src/modules/communications/suppression.service';
import { PromoCodesService } from '../../../src/modules/billing/promo-codes.service';
import { CheckInService } from '../../../src/modules/guests/check-in.service';
import { PaymentGatewayRegistry } from '../../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../../src/modules/payments/payments.service';
import { FakeGateway } from '../../../src/modules/payments/providers/fake.gateway';
import { BankDeclinedError } from '../../../src/modules/payments/providers/payment-provider';
import { TicketAttendeesService } from '../../../src/modules/ticketing/ticket-attendees.service';
import { TicketCancellationService } from '../../../src/modules/ticketing/ticket-cancellation.service';
import { TicketFulfilmentService } from '../../../src/modules/ticketing/ticket-fulfilment.service';
import { TicketInventoryService } from '../../../src/modules/ticketing/ticket-inventory.service';
import { TicketNotifierService } from '../../../src/modules/ticketing/ticket-notifier.service';
import { TicketingService } from '../../../src/modules/ticketing/ticketing.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { attendeeRoster, ticketEvent } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Host cancellation and reconciliation against real Postgres (docs/API.md §5
 * "Cancelling an order" and "Reviewing and reconciling attendees"): what the
 * bank's answer does to admission, what is given back exactly once, and every
 * reason an explicit guest link is refused without changing anything.
 */
describe('Ticket cancellation and reconciliation (integration coverage)', () => {
  let prisma: PrismaClient;
  let fake: FakeGateway;
  let payments: PaymentsService;
  let ticketing: TicketingService;
  let cancellation: TicketCancellationService;
  let attendees: TicketAttendeesService;
  let checkIn: CheckInService;
  const previousPilotMode = process.env.PILOT_MODE;

  beforeAll(() => {
    process.env.PILOT_MODE = 'false';
    prisma = testPrisma();
    const database = prisma as unknown as PrismaService;
    fake = new FakeGateway();
    payments = new PaymentsService(database, new PaymentGatewayRegistry([fake]));
    const promoCodes = new PromoCodesService(database);
    const transports = new Map<MessageChannel, MessageTransport>(
      Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]),
    );
    const communications = new CommunicationsService(database, transports, new SuppressionService(database));
    const notifier = new TicketNotifierService(database, communications, { get: () => 'https://aveline.test' } as unknown as ConfigService);
    const fulfilment = new TicketFulfilmentService(database, new TicketInventoryService(database), promoCodes, notifier);
    ticketing = new TicketingService(database, payments, promoCodes, fulfilment);
    cancellation = new TicketCancellationService(database, payments, fulfilment);
    attendees = new TicketAttendeesService(database);
    checkIn = new CheckInService(database);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    for (const key of ['ticket.issued', 'ticket.cancelled']) {
      await prisma.messageTemplate.create({
        data: { organizationId: null, key, channel: MessageChannel.EMAIL, subject: { hy: key, en: key }, body: { hy: '{{buyerName}} {{eventTitle}}', en: '{{buyerName}} {{eventTitle}}' } },
      });
    }
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await disconnectTestDatabase();
    if (previousPilotMode === undefined) delete process.env.PILOT_MODE;
    else process.env.PILOT_MODE = previousPilotMode;
  });

  /** A public event selling a type at `priceMinor`, with one invited guest already on the list. */
  const pricedEvent = async (priceMinor = 10_000n) => {
    const event = await ticketEvent(prisma);
    const type = await prisma.ticketType.create({ data: { eventId: event.eventId, name: { en: 'GA' }, priceMinor, quantityTotal: 20, maxPerOrder: 10 } });
    return { ...event, pricedTypeId: type.id };
  };
  type PricedEvent = Awaited<ReturnType<typeof pricedEvent>>;

  const place = (event: PricedEvent, quantity: number, promoCode?: string) =>
    ticketing.createOrder(event.slug, {
      items: [{ ticketTypeId: event.pricedTypeId, quantity }],
      attendees: attendeeRoster(event.pricedTypeId, quantity),
      buyerName: 'Ani',
      buyerEmail: 'buyer@test.local',
      provider: PaymentProvider.FAKE,
      idempotencyKey: randomUUID(),
      ...(promoCode ? { promoCode } : {}),
    });

  /** Placed, paid at the bank and confirmed: a PAID order with VALID tickets. */
  const paidOrder = async (event: PricedEvent, quantity = 2, promoCode?: string) => {
    const created = await place(event, quantity, promoCode);
    const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: created.orderId } });
    fake.simulateSuccess(`fake_${order.paymentOrderNumber!}`);
    await ticketing.confirmOrder(order.accessToken);
    return prisma.ticketOrder.findUniqueOrThrow({ where: { id: created.orderId }, include: { tickets: true } });
  };

  const paymentOf = (orderNumber: string) => prisma.payment.findUniqueOrThrow({ where: { orderNumber } });

  describe('when the bank refuses or does not answer a cancellation refund', () => {
    it('reopens the order, paid and admittable, after a definite refusal', async () => {
      const event = await pricedEvent();
      const order = await paidOrder(event, 1);
      jest.spyOn(fake, 'refund').mockRejectedValueOnce(new BankDeclinedError('declined'));

      await expect(cancellation.cancel(event.eventId, order.id)).rejects.toBeInstanceOf(BankDeclinedError);

      expect(await prisma.ticketOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: TicketOrderStatus.PAID, cancellationStartedAt: null });
      expect((await paymentOf(order.paymentOrderNumber!)).refundedMinor).toBe(0n);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: order.tickets[0].id } })).status).toBe('VALID');
      await expect(ticketing.admit(event.eventId, order.tickets[0].code)).resolves.toMatchObject({ code: order.tickets[0].code });
    });

    /** An unknown outcome may have paid the buyer: the ticket must not open the door meanwhile. */
    const uncertain = async () => {
      const event = await pricedEvent();
      const order = await paidOrder(event, 1);
      const refund = jest.spyOn(fake, 'refund').mockRejectedValueOnce(new Error('connection reset'));
      await expect(cancellation.cancel(event.eventId, order.id)).rejects.toThrow(/outcome is unknown/);
      return { event, order, ticket: order.tickets[0], refund };
    };

    it('keeps admission frozen and the refund claimed after an unknown outcome', async () => {
      const { order } = await uncertain();

      const current = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(current.status).toBe(TicketOrderStatus.PAID);
      expect(current.cancellationStartedAt).toBeInstanceOf(Date);
      expect((await paymentOf(order.paymentOrderNumber!)).refundedMinor).toBe(10_000n);
    });

    it('refuses the frozen ticket at the ticket scanner and the guest check-in', async () => {
      const { event, ticket } = await uncertain();

      await expect(ticketing.admit(event.eventId, ticket.code)).rejects.toThrow(/cancellation is in progress/);
      await expect(checkIn.checkIn(event.eventId, ticket.guestId!)).rejects.toThrow(/cancellation is in progress/);
      expect(await prisma.checkIn.count()).toBe(0);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe('VALID');
    });

    it('refuses to reconcile the frozen ticket to an invited guest', async () => {
      const { event, ticket } = await uncertain();
      const invited = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });

      await expect(attendees.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: ticket.guestId, keepExistingAnswers: true }))
        .rejects.toThrow('Only active paid tickets may be reconciled');
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).guestId).toBe(ticket.guestId);
    });

    it('does not ask the bank a second time when the cancellation is retried', async () => {
      const { event, order, refund } = await uncertain();
      // The retry waits up to the bank timeout for the claimed refund to settle;
      // each clock reading jumps past that deadline instead of sleeping.
      const now = Date.now.bind(Date);
      let readings = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => now() + (readings += 1) * 60_000);

      const retried = await cancellation.cancel(event.eventId, order.id);

      expect(refund).toHaveBeenCalledTimes(1);
      expect(retried.status).toBe(TicketOrderStatus.PAID);
      expect(await prisma.refund.count()).toBe(1);
    });
  });

  describe('what a successful cancellation gives back', () => {
    const halfOff = async (event: PricedEvent) => {
      const { organizationId } = await prisma.event.findUniqueOrThrow({ where: { id: event.eventId } });
      return prisma.promoCode.create({ data: { organizationId, code: 'HALF', kind: DiscountKind.PERCENT, value: 50n, maxRedemptions: 1 } });
    };

    it('returns the promo-code use exactly once under concurrent cancellations', async () => {
      const event = await pricedEvent();
      const code = await halfOff(event);
      const order = await paidOrder(event, 2, 'HALF');
      expect((await prisma.promoCode.findUniqueOrThrow({ where: { id: code.id } })).redemptions).toBe(1);

      const results = await Promise.all([1, 2, 3].map(() => cancellation.cancel(event.eventId, order.id)));

      expect(results.map((result) => result.status)).toEqual(['REFUNDED', 'REFUNDED', 'REFUNDED']);
      expect((await prisma.promoCode.findUniqueOrThrow({ where: { id: code.id } })).redemptions).toBe(0);
      expect((await paymentOf(order.paymentOrderNumber!)).refundedMinor).toBe(10_000n);
    });

    it('lets the next buyer use the returned code', async () => {
      const event = await pricedEvent();
      const code = await halfOff(event);
      const order = await paidOrder(event, 2, 'HALF');
      await cancellation.cancel(event.eventId, order.id);

      const next = await place(event, 2, 'HALF');

      expect(next).toMatchObject({ status: 'RESERVED', discountMinor: '10000', totalMinor: '10000' });
      expect((await prisma.promoCode.findUniqueOrThrow({ where: { id: code.id } })).redemptions).toBe(1);
    });

    it('emails the buyer once, however many times it is cancelled', async () => {
      const event = await pricedEvent();
      const order = await paidOrder(event, 2);

      await Promise.all([cancellation.cancel(event.eventId, order.id), cancellation.cancel(event.eventId, order.id)]);
      await cancellation.cancel(event.eventId, order.id);

      const messages = await prisma.message.findMany({ where: { templateKey: 'ticket.cancelled' } });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ dedupeKey: `ticket-cancelled:${order.id}`, toAddress: 'buyer@test.local', channel: MessageChannel.EMAIL });
    });

    it('refuses an order whose hold lapsed unpaid, as there is nothing to refund', async () => {
      const event = await pricedEvent();
      const created = await place(event, 2);
      await prisma.ticketOrder.update({ where: { id: created.orderId }, data: { reservesUntil: new Date(Date.now() - 1000) } });
      await ticketing.releaseExpiredReservations();

      await expect(cancellation.cancel(event.eventId, created.orderId)).rejects.toThrow(/expired, not paid, so there is nothing to cancel/);
      expect(await prisma.message.count({ where: { templateKey: 'ticket.cancelled' } })).toBe(0);
      expect(await prisma.refund.count()).toBe(0);
    });
  });

  describe('linking a ticket to an invited guest is refused', () => {
    /** A free checkout ticket (with its auto-created guest) and the invited guest it could be linked to. */
    const checkoutTicket = async () => {
      const event = await ticketEvent(prisma);
      const created = await ticketing.createOrder(event.slug, { items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }],
        attendees: attendeeRoster(event.ticketTypeId, 1), buyerName: 'Ani', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID() });
      const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: created.orderId } });
      const invited = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
      return { event, orderId: created.orderId, ticket, invited };
    };

    /** A ticket from before named checkout, linked to nobody. */
    const legacyTicket = async (data: { status?: 'VALID' | 'USED'; usedAt?: Date | null; orderStatus?: TicketOrderStatus } = {}) => {
      const event = await ticketEvent(prisma);
      const order = await prisma.ticketOrder.create({ data: { eventId: event.eventId, buyerName: 'Buyer', buyerEmail: 'buyer@test.local', totalMinor: 0n,
        currency: 'AMD', status: data.orderStatus ?? 'PAID', idempotencyKey: randomUUID(), accessToken: randomUUID() } });
      const ticket = await prisma.ticket.create({ data: { eventId: event.eventId, orderId: order.id, ticketTypeId: event.ticketTypeId, code: randomUUID(),
        status: data.status ?? 'VALID', usedAt: data.usedAt ?? null } });
      const invited = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
      return { event, ticket, invited };
    };

    const unchanged = async (eventId: string, ticket: { id: string; guestId: string | null }, guests: number) => {
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).guestId).toBe(ticket.guestId);
      expect(await prisma.guest.count({ where: { eventId } })).toBe(guests);
    };

    it('when the ticket guest changed since the host reviewed it', async () => {
      const { event, ticket, invited } = await checkoutTicket();

      await expect(attendees.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: invited.id, keepExistingAnswers: true }))
        .rejects.toThrow('Ticket guest changed; review the current link');
      await unchanged(event.eventId, ticket, 2);
    });

    it('when the invited guest was erased', async () => {
      const { event, ticket, invited } = await checkoutTicket();
      await prisma.guest.update({ where: { id: invited.id }, data: { anonymizedAt: new Date() } });

      await expect(attendees.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: ticket.guestId, keepExistingAnswers: true }))
        .rejects.toThrow('An erased guest cannot be linked');
      await unchanged(event.eventId, ticket, 2);
    });

    it('when the checkout attendee was erased', async () => {
      const { event, ticket, invited } = await checkoutTicket();
      await prisma.orderAttendee.update({ where: { id: ticket.attendeeId! }, data: { erasedAt: new Date() } });

      await expect(attendees.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: ticket.guestId, keepExistingAnswers: true }))
        .rejects.toThrow('An erased attendee cannot be linked');
      await unchanged(event.eventId, ticket, 2);
    });

    it('when it would replace an invited guest already linked with someone else', async () => {
      const { event, ticket, invited } = await checkoutTicket();
      await attendees.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: ticket.guestId, keepExistingAnswers: true });
      const third = await prisma.guest.create({ data: { eventId: event.eventId, householdId: invited.householdId, firstName: 'Third', token: randomUUID() } });

      await expect(attendees.linkGuest(event.eventId, ticket.id, { guestId: third.id, expectedGuestId: invited.id, keepExistingAnswers: true }))
        .rejects.toThrow('An invited guest cannot be replaced by another person');
      await unchanged(event.eventId, { id: ticket.id, guestId: invited.id }, 2);
    });

    /** Each kind of history that makes the checkout duplicate unsafe to delete. */
    const histories: { label: string; leave: (event: Awaited<ReturnType<typeof checkoutTicket>>) => Promise<unknown> }[] = [
      { label: 'was already admitted', leave: ({ event, ticket }) => ticketing.admit(event.eventId, ticket.code) },
      { label: 'has been messaged', leave: ({ event, ticket }) => prisma.message.create({ data: { eventId: event.eventId, guestId: ticket.guestId,
        channel: MessageChannel.EMAIL, toAddress: 'attendee@test.local', body: 'Hello' } }) },
      { label: 'has a messaging channel', leave: ({ ticket }) => prisma.guestChannel.create({ data: { guestId: ticket.guestId!, channel: MessageChannel.EMAIL,
        address: 'attendee@test.local' } }) },
      { label: 'has a registered device', leave: ({ ticket }) => prisma.deviceToken.create({ data: { guestId: ticket.guestId!, platform: 'IOS', token: randomUUID() } }) },
      { label: 'has signed', leave: async ({ event, ticket }) => {
        const signature = await prisma.mediaAsset.create({ data: { eventId: event.eventId, kind: 'SIGNATURE', url: 'https://media.test/signature.png' } });
        return prisma.rsvp.update({ where: { guestId: ticket.guestId! }, data: { signatureAssetId: signature.id } });
      } },
    ];

    it.each(histories)('when the checkout guest $label', async ({ leave }) => {
      const checkout = await checkoutTicket();
      const { event, ticket, invited } = checkout;
      await leave(checkout);

      await expect(attendees.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: ticket.guestId, keepExistingAnswers: true }))
        .rejects.toThrow('Checkout guest has seats, admission, a signature or communication history; resolve those before linking');
      await unchanged(event.eventId, ticket, 2);
      expect(await prisma.guest.findUnique({ where: { id: ticket.guestId! } })).not.toBeNull();
      expect(await prisma.checkIn.findUnique({ where: { guestId: invited.id } })).toBeNull();
    });

    it('when a used legacy ticket has no admission time', async () => {
      const { event, ticket, invited } = await legacyTicket({ status: 'USED', usedAt: null });

      await expect(attendees.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: null, keepExistingAnswers: true }))
        .rejects.toThrow('Used legacy ticket has no admission timestamp; staff review is required');
      await unchanged(event.eventId, ticket, 1);
      expect(await prisma.checkIn.count()).toBe(0);
    });

    it('when the ticket and the guest record different admission times', async () => {
      const { event, ticket, invited } = await legacyTicket({ status: 'USED', usedAt: new Date('2026-10-01T12:00:00Z') });
      await prisma.checkIn.create({ data: { guestId: invited.id, arrivedAt: new Date('2026-10-01T12:30:00Z') } });

      await expect(attendees.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: null, keepExistingAnswers: true }))
        .rejects.toThrow('Two admission records disagree; staff review is required');
      await unchanged(event.eventId, ticket, 1);
      expect((await prisma.checkIn.findUniqueOrThrow({ where: { guestId: invited.id } })).arrivedAt).toEqual(new Date('2026-10-01T12:30:00Z'));
    });

    it('when the ticket was voided by cancellation', async () => {
      const { event, orderId, ticket, invited } = await checkoutTicket();
      await cancellation.cancel(event.eventId, orderId);

      await expect(attendees.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: ticket.guestId, keepExistingAnswers: true }))
        .rejects.toThrow('Only active paid tickets may be reconciled');
      await unchanged(event.eventId, ticket, 2);
    });

    it('when the ticket’s order was never paid', async () => {
      const { event, ticket, invited } = await legacyTicket({ orderStatus: TicketOrderStatus.RESERVED });

      await expect(attendees.linkGuest(event.eventId, ticket.id, { guestId: invited.id, expectedGuestId: null, keepExistingAnswers: true }))
        .rejects.toThrow('Only active paid tickets may be reconciled');
      await unchanged(event.eventId, ticket, 1);
    });
  });
});
