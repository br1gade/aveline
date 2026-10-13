import { ConfigService } from '@nestjs/config';
import { MessageChannel, PaymentProvider, PaymentStatus, PrismaClient, TicketOrderStatus } from '@prisma/client';
import { ConsoleTransport } from '../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { PromoCodesService } from '../../src/modules/billing/promo-codes.service';
import { PaymentGatewayRegistry } from '../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { FakeGateway } from '../../src/modules/payments/providers/fake.gateway';
import { TicketFulfilmentService } from '../../src/modules/ticketing/ticket-fulfilment.service';
import { TicketInventoryService } from '../../src/modules/ticketing/ticket-inventory.service';
import { TicketNotifierService } from '../../src/modules/ticketing/ticket-notifier.service';
import { TicketingService } from '../../src/modules/ticketing/ticketing.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * What happens to a ticket order around the edges of its payment: a buyer who
 * pays and never comes back, a checkout that fails half-way, a confirmation
 * email that did not get queued.
 */
describe('ticket settlement (integration)', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let ticketing: TicketingService;
  let notifier: TicketNotifierService;
  let fake: FakeGateway;
  let fulfilment: TicketFulfilmentService;
  let eventId: string;

  beforeAll(() => {
    prisma = testPrisma();
    const database = prisma as unknown as PrismaService;
    fake = new FakeGateway();
    payments = new PaymentsService(database, new PaymentGatewayRegistry([fake]));
    const inventory = new TicketInventoryService(database);
    const promoCodes = new PromoCodesService(database);
    const transports = new Map<MessageChannel, MessageTransport>(
      Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]),
    );
    const communications = new CommunicationsService(database, transports, new SuppressionService(database));
    notifier = new TicketNotifierService(database, communications, { get: () => 'https://aveline.test' } as unknown as ConfigService);
    fulfilment = new TicketFulfilmentService(database, inventory, promoCodes, notifier);
    ticketing = new TicketingService(database, payments, promoCodes, fulfilment);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    eventId = (await seedEvent(prisma)).eventId;
    for (const key of ['ticket.issued', 'ticket.cancelled']) {
      await prisma.messageTemplate.create({
        data: { organizationId: null, key, channel: MessageChannel.EMAIL, subject: { hy: key }, body: { hy: '{{buyerName}} {{eventTitle}}' } },
      });
    }
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => disconnectTestDatabase());

  const onSale = async (quantityTotal: number) => {
    const type = await prisma.ticketType.create({
      data: { eventId, name: { en: 'GA' }, priceMinor: 10_000n, quantityTotal, maxPerOrder: 10 },
    });
    await prisma.event.update({ where: { id: eventId }, data: { visibility: 'PUBLIC' } });
    const listing = await prisma.eventListing.create({
      data: { eventId, slug: `s-${Math.random().toString(36).slice(2, 8)}`, publishedAt: new Date() },
    });
    return { ticketTypeId: type.id, slug: listing.slug };
  };

  const buy = (slug: string, ticketTypeId: string, quantity: number) =>
    ticketing.createOrder(slug, {
      items: [{ ticketTypeId, quantity }],
      buyerName: 'Ani',
      buyerEmail: 'ani@test.local',
      idempotencyKey: `order-${Math.random()}`,
      provider: PaymentProvider.FAKE,
    });

  /** The buyer pays at the bank; we are not told. */
  const paysAtTheBank = async (orderId: string) => {
    const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId } });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: order.paymentOrderNumber! } });
    fake.simulateSuccess(payment.providerRef!);
    return { order, payment };
  };

  const lapse = (orderId: string) =>
    prisma.ticketOrder.update({ where: { id: orderId }, data: { reservesUntil: new Date(Date.now() - 1000) } });

  const sold = async (ticketTypeId: string) => {
    const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    return { sold: type.quantitySold, reserved: type.quantityReserved };
  };

  it('rejects a pilot charge without consuming inventory or creating an order', async () => {
    const { slug, ticketTypeId } = await onSale(10);
    const previous = process.env.PILOT_MODE;
    process.env.PILOT_MODE = 'true';
    try {
      await expect(buy(slug, ticketTypeId, 2)).rejects.toThrow('Payments are disabled for the free pilot');
      expect(await sold(ticketTypeId)).toEqual({ sold: 0, reserved: 0 });
      expect(await prisma.ticketOrder.count()).toBe(0);
      expect(await prisma.payment.count()).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.PILOT_MODE;
      else process.env.PILOT_MODE = previous;
    }
  });

  it('allows free tickets in pilot mode', async () => {
    const { slug, ticketTypeId } = await onSale(10);
    await prisma.ticketType.update({ where: { id: ticketTypeId }, data: { priceMinor: 0n } });
    const previous = process.env.PILOT_MODE;
    process.env.PILOT_MODE = 'true';
    try {
      const order = await buy(slug, ticketTypeId, 2);
      expect(order.status).toBe('PAID');
      expect(await sold(ticketTypeId)).toEqual({ sold: 2, reserved: 0 });
      expect(await prisma.payment.count()).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.PILOT_MODE;
      else process.env.PILOT_MODE = previous;
    }
  });

  // B36: the hold lapsed without asking the bank, the seats were resold, and
  // the buyer's money was taken with no ticket and no refund.
  describe('a buyer who pays and does not come back', () => {
    it('gets their tickets when the hold lapses after the bank took the money', async () => {
      const { slug, ticketTypeId } = await onSale(10);
      const created = await buy(slug, ticketTypeId, 2);
      await paysAtTheBank(created.orderId);
      await lapse(created.orderId);

      await ticketing.releaseExpiredReservations();

      const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: created.orderId }, include: { tickets: true } });
      expect(order.status).toBe(TicketOrderStatus.PAID);
      expect(order.tickets).toHaveLength(2);
      expect(await sold(ticketTypeId)).toEqual({ sold: 2, reserved: 0 });
    });

    it('gets their tickets when the payment lands after the hold was released, if seats remain', async () => {
      const { slug, ticketTypeId } = await onSale(10);
      const created = await buy(slug, ticketTypeId, 2);
      await lapse(created.orderId);
      await ticketing.releaseExpiredReservations();
      await paysAtTheBank(created.orderId);

      await payments.reconcile();
      await ticketing.settleCapturedPayments();

      const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: created.orderId }, include: { tickets: true } });
      expect(order.status).toBe(TicketOrderStatus.PAID);
      expect(order.tickets).toHaveLength(2);
      expect(await sold(ticketTypeId)).toEqual({ sold: 2, reserved: 0 });
      expect(await prisma.message.count({ where: { dedupeKey: `ticket-issued:${created.orderId}` } })).toBe(1);
    });

    // B85: expiring gave the redemption back and late issuance never took it
    // again, so a later cancellation gave it back a second time.
    it('takes the promo redemption again when it issues late', async () => {
      const { slug, ticketTypeId } = await onSale(10);
      const { organizationId } = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      const code = await prisma.promoCode.create({
        data: { organizationId, code: 'FRIENDS', kind: 'PERCENT', value: 10n, maxRedemptions: 1 },
      });
      const created = await ticketing.createOrder(slug, {
        items: [{ ticketTypeId, quantity: 1 }],
        buyerName: 'Ani',
        buyerEmail: 'ani@test.local',
        idempotencyKey: 'order-with-code',
        provider: PaymentProvider.FAKE,
        promoCode: 'FRIENDS',
      });
      await lapse(created.orderId);
      await ticketing.releaseExpiredReservations();
      expect((await prisma.promoCode.findUniqueOrThrow({ where: { id: code.id } })).redemptions).toBe(0);
      await paysAtTheBank(created.orderId);

      await payments.reconcile();
      await ticketing.settleCapturedPayments();

      expect((await prisma.ticketOrder.findUniqueOrThrow({ where: { id: created.orderId } })).status).toBe(TicketOrderStatus.PAID);
      expect((await prisma.promoCode.findUniqueOrThrow({ where: { id: code.id } })).redemptions).toBe(1);
    });

    // B85: the order is marked refunded before the bank is asked, and the
    // notice sweep told the buyer "refunded" while the refund was still unknown.
    it('does not say refunded until the bank has refunded', async () => {
      const { slug, ticketTypeId } = await onSale(2);
      const late = await buy(slug, ticketTypeId, 2);
      await lapse(late.orderId);
      await ticketing.releaseExpiredReservations();
      const other = await buy(slug, ticketTypeId, 2);
      await paysAtTheBank(other.orderId);
      await ticketing.confirmOrder(other.accessToken);
      const { order } = await paysAtTheBank(late.orderId);
      jest.spyOn(fake, 'refund').mockRejectedValueOnce(new Error('connection reset'));

      await ticketing.confirmOrder(order.accessToken).catch(() => undefined);
      await ticketing.sendMissingNotices();

      expect((await prisma.ticketOrder.findUniqueOrThrow({ where: { id: late.orderId } })).status).toBe(TicketOrderStatus.REFUNDED);
      expect(await prisma.message.count({ where: { dedupeKey: `ticket-cancelled:${late.orderId}` } })).toBe(0);
    });

    it('is refunded in full, and told, when the seats were sold in the meantime', async () => {
      const { slug, ticketTypeId } = await onSale(2);
      const late = await buy(slug, ticketTypeId, 2);
      await lapse(late.orderId);
      await ticketing.releaseExpiredReservations();
      const other = await buy(slug, ticketTypeId, 2);
      await paysAtTheBank(other.orderId);
      await ticketing.confirmOrder(other.accessToken);
      const { order } = await paysAtTheBank(late.orderId);

      await ticketing.confirmOrder(order.accessToken);

      const after = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: late.orderId }, include: { tickets: true } });
      expect(after.status).toBe(TicketOrderStatus.REFUNDED);
      expect(after.tickets).toHaveLength(0);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: order.paymentOrderNumber! } });
      expect(payment).toMatchObject({ status: PaymentStatus.REFUNDED, refundedMinor: 20_000n });
      expect(await sold(ticketTypeId)).toEqual({ sold: 2, reserved: 0 });
      expect(await prisma.message.count({ where: { dedupeKey: `ticket-cancelled:${late.orderId}` } })).toBe(1);
    });

    // B85: one paid order that could not be settled threw out of the loop,
    // and no abandoned checkout's seats were released that run.
    it('still releases abandoned holds when one paid order cannot be settled', async () => {
      const { slug, ticketTypeId } = await onSale(10);
      const paid = await buy(slug, ticketTypeId, 1);
      const abandoned = await buy(slug, ticketTypeId, 2);
      await paysAtTheBank(paid.orderId);
      await lapse(paid.orderId);
      await lapse(abandoned.orderId);
      jest.spyOn(fulfilment, 'markPaid').mockRejectedValueOnce(new Error('database blip'));

      await ticketing.releaseExpiredReservations();

      const after = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: abandoned.orderId } });
      expect(after.status).toBe(TicketOrderStatus.EXPIRED);
    });

    it('settles once however many times it is asked', async () => {
      const { slug, ticketTypeId } = await onSale(10);
      const created = await buy(slug, ticketTypeId, 1);
      await lapse(created.orderId);
      await ticketing.releaseExpiredReservations();
      const { order } = await paysAtTheBank(created.orderId);

      await Promise.all([ticketing.confirmOrder(order.accessToken), ticketing.settleCapturedPayments(), ticketing.confirmOrder(order.accessToken)]);

      expect(await prisma.ticket.count({ where: { orderId: created.orderId } })).toBe(1);
      expect(await sold(ticketTypeId)).toEqual({ sold: 1, reserved: 0 });
    });
  });

  // B37: a checkout that failed after its order was written released its
  // seats, left the order RESERVED, and the sweep released them again.
  // B87: a retry got the order without its bank link, and a double tap that
  // raced to the same key got a 409.
  describe('a checkout sent twice', () => {
    it('answers both with the one order and its payment link, holding the seats once', async () => {
      const { slug, ticketTypeId } = await onSale(10);
      const send = () =>
        ticketing.createOrder(slug, {
          items: [{ ticketTypeId, quantity: 2 }],
          buyerName: 'Ani',
          buyerEmail: 'ani@test.local',
          idempotencyKey: 'double-tap',
          provider: PaymentProvider.FAKE,
        });

      const [first, second] = await Promise.all([send(), send()]);
      const retry = await send();

      expect(second.orderId).toBe(first.orderId);
      expect(retry.orderId).toBe(first.orderId);
      for (const answer of [first, second, retry]) {
        expect((answer as { payment?: { redirectUrl: string | null } }).payment?.redirectUrl).toEqual(expect.any(String));
      }
      expect(await sold(ticketTypeId)).toEqual({ sold: 0, reserved: 2 });
    });
  });

  describe('a checkout that fails half-way', () => {
    it('gives its seats back once, and the next buyer can pay', async () => {
      const { slug, ticketTypeId } = await onSale(2);
      jest.spyOn(fake, 'registerOrder').mockRejectedValueOnce(new Error('bank unreachable'));

      await expect(buy(slug, ticketTypeId, 2)).rejects.toThrow(/bank unreachable/);
      await ticketing.releaseExpiredReservations();

      expect(await sold(ticketTypeId)).toEqual({ sold: 0, reserved: 0 });
      expect(await prisma.ticketOrder.count({ where: { status: TicketOrderStatus.RESERVED } })).toBe(0);
      const next = await buy(slug, ticketTypeId, 2);
      await paysAtTheBank(next.orderId);
      await expect(ticketing.confirmOrder(next.accessToken)).resolves.toMatchObject({ status: TicketOrderStatus.PAID });
    });
  });

  // B43: queued after the transaction with errors swallowed, and a retry
  // returned early because the order was already paid.
  describe('the confirmation email', () => {
    it('is queued by the next sweep when queueing it failed the first time', async () => {
      const { slug, ticketTypeId } = await onSale(10);
      const created = await buy(slug, ticketTypeId, 1);
      await paysAtTheBank(created.orderId);
      jest.spyOn(CommunicationsService.prototype, 'enqueue').mockRejectedValueOnce(new Error('connection reset'));
      await ticketing.confirmOrder(created.accessToken);
      expect(await prisma.message.count({ where: { dedupeKey: `ticket-issued:${created.orderId}` } })).toBe(0);

      await notifier.sendMissing();

      expect(await prisma.message.count({ where: { dedupeKey: `ticket-issued:${created.orderId}` } })).toBe(1);
    });

    it('is queued when the buyer retries, if it was lost', async () => {
      const { slug, ticketTypeId } = await onSale(10);
      const created = await buy(slug, ticketTypeId, 1);
      await paysAtTheBank(created.orderId);
      jest.spyOn(CommunicationsService.prototype, 'enqueue').mockRejectedValueOnce(new Error('connection reset'));
      await ticketing.confirmOrder(created.accessToken);

      await ticketing.confirmOrder(created.accessToken);

      expect(await prisma.message.count({ where: { dedupeKey: `ticket-issued:${created.orderId}` } })).toBe(1);
    });
  });
});
