import {
  DiscountKind,
  MessageChannel,
  PaymentEventSource,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  PrismaClient,
  TicketOrderStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ConsoleTransport } from '../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PaymentGatewayRegistry } from '../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { FakeGateway } from '../../src/modules/payments/providers/fake.gateway';
import { TicketInventoryService } from '../../src/modules/ticketing/ticket-inventory.service';
import { TicketCancellationService } from '../../src/modules/ticketing/ticket-cancellation.service';
import { TicketFulfilmentService } from '../../src/modules/ticketing/ticket-fulfilment.service';
import { TicketNotifierService } from '../../src/modules/ticketing/ticket-notifier.service';
import { PromoCodesService } from '../../src/modules/billing/promo-codes.service';
import { TicketingService } from '../../src/modules/ticketing/ticketing.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Exactly-once guarantees on anything that moves money or allocates a seat.
 *
 * These are the failures that cannot be apologised away: a customer charged
 * twice, refunded twice, or holding two tickets for one paid seat. Each test
 * here reproduces a specific way the code could get it wrong under
 * concurrency, so a future change that reintroduces one fails loudly.
 */
describe('transaction safety (integration)', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let ticketing: TicketingService;
  let cancellation: TicketCancellationService;
  let inventory: TicketInventoryService;
  let fake: FakeGateway;
  let organizationId: string;
  let eventId: string;

  beforeAll(() => {
    prisma = testPrisma();
    fake = new FakeGateway();
    const registry = new PaymentGatewayRegistry([fake]);
    payments = new PaymentsService(prisma as unknown as PrismaService, registry);
    inventory = new TicketInventoryService(prisma as unknown as PrismaService);
    const promoCodes = new PromoCodesService(prisma as unknown as PrismaService);
    const suppressions = new SuppressionService(prisma as unknown as PrismaService);
    const transports = new Map<MessageChannel, MessageTransport>(
      Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]),
    );
    const communications = new CommunicationsService(
      prisma as unknown as PrismaService,
      transports,
      suppressions,
    );
    const notifier = new TicketNotifierService(
      prisma as unknown as PrismaService,
      communications,
      { get: () => 'https://aveline.test' } as unknown as ConfigService,
    );
    const fulfilment = new TicketFulfilmentService(
      prisma as unknown as PrismaService,
      inventory,
      promoCodes,
      notifier,
    );
    ticketing = new TicketingService(
      prisma as unknown as PrismaService,
      payments,
      promoCodes,
      fulfilment,
    );
    cancellation = new TicketCancellationService(
      prisma as unknown as PrismaService,
      payments,
      fulfilment,
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    const seeded = await seedEvent(prisma);
    eventId = seeded.eventId;
    organizationId = (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).organizationId;
  });

  afterAll(() => disconnectTestDatabase());

  const startPayment = (idempotencyKey: string) =>
    payments.start({
      organizationId,
      eventId,
      purpose: PaymentPurpose.DEPOSIT,
      provider: PaymentProvider.FAKE,
      amountMinor: '100000',
      currency: 'AMD',
      returnUrl: 'https://aveline.test/return',
      idempotencyKey,
    });

  const capturedPayment = async () => {
    const started = await startPayment(`key-${Math.random()}`);
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { orderNumber: started.orderNumber },
    });
    fake.simulateSuccess(payment.providerRef!);
    await payments.confirm(started.orderNumber, PaymentEventSource.CALLBACK);
    return started.orderNumber;
  };

  describe('idempotent registration', () => {
    // A retried request must return the original, not an error. Failing the
    // retry is how a client ends up registering a second order.
    it('returns the same payment to every concurrent caller, none failing', async () => {
      const key = 'same-key-for-all';

      const results = await Promise.allSettled([
        startPayment(key),
        startPayment(key),
        startPayment(key),
        startPayment(key),
      ]);

      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(0);

      const orderNumbers = new Set(
        results.map((r) => (r as PromiseFulfilledResult<{ orderNumber: string }>).value.orderNumber),
      );
      expect(orderNumbers.size).toBe(1);
      expect(await prisma.payment.count()).toBe(1);
    });
  });

  describe('refunds', () => {
    // The expensive one: money leaving twice for one request.
    it('never asks the bank to refund more than was captured, under concurrency', async () => {
      const orderNumber = await capturedPayment();

      await Promise.allSettled([
        payments.refund(orderNumber, 60_000n),
        payments.refund(orderNumber, 60_000n),
      ]);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber } });
      expect(payment.refundedMinor).toBeLessThanOrEqual(payment.amountMinor);

      // Every refund that reached the gateway must be recorded, or the books
      // disagree with the bank statement.
      const refunds = await prisma.refund.findMany({ where: { paymentId: payment.id } });
      const recorded = refunds
        .filter((r) => r.status !== 'FAILED')
        .reduce((sum, r) => sum + r.amountMinor, 0n);
      expect(recorded).toBe(payment.refundedMinor);
    });

    it('records each refund individually, not just a running total', async () => {
      const orderNumber = await capturedPayment();

      await payments.refund(orderNumber, 30_000n);
      await payments.refund(orderNumber, 20_000n);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber } });
      const refunds = await prisma.refund.findMany({ where: { paymentId: payment.id } });

      expect(refunds).toHaveLength(2);
      expect(payment.refundedMinor).toBe(50_000n);
      expect(payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    });

    it('refuses to exceed the captured amount', async () => {
      const orderNumber = await capturedPayment();
      await payments.refund(orderNumber, 90_000n);

      await expect(payments.refund(orderNumber, 20_000n)).rejects.toThrow();

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber } });
      expect(payment.refundedMinor).toBe(90_000n);
    });
  });

  describe('ticket issuance', () => {
    const paidOrder = async (quantity: number) => {
      const type = await prisma.ticketType.create({
        data: { eventId, name: { en: 'GA' }, priceMinor: 0n, quantityTotal: 50, maxPerOrder: 50 },
      });
      await prisma.eventListing.create({
        data: { eventId, slug: `t-${Math.random().toString(36).slice(2, 8)}`, publishedAt: new Date() },
      });
      await prisma.event.update({ where: { id: eventId }, data: { visibility: 'PUBLIC' } });

      const listing = await prisma.eventListing.findFirstOrThrow({ where: { eventId } });
      const order = await ticketing.createOrder(listing.slug, {
        items: [{ ticketTypeId: type.id, quantity }],
        buyerName: 'Buyer',
        buyerEmail: 'buyer@test.local',
        idempotencyKey: `order-${Math.random()}`,
      });
      return { orderId: order.orderId, ticketTypeId: type.id };
    };

    // A free event settles immediately, so this exercises the same path a
    // paid one reaches after the bank confirms.
    it('issues exactly one ticket per seat, however many times settlement runs', async () => {
      const { orderId, ticketTypeId } = await paidOrder(3);

      await Promise.allSettled([
        ticketing.markPaid(orderId),
        ticketing.markPaid(orderId),
        ticketing.markPaid(orderId),
      ]);

      expect(await prisma.ticket.count({ where: { orderId } })).toBe(3);

      const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
      expect(type.quantitySold).toBe(3);
      expect(type.quantityReserved).toBe(0);
    });

    it('leaves the order PAID exactly once', async () => {
      const { orderId } = await paidOrder(2);

      await ticketing.markPaid(orderId);
      await ticketing.markPaid(orderId);

      const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe(TicketOrderStatus.PAID);
      expect(await prisma.ticket.count({ where: { orderId } })).toBe(2);
    });
  });
  describe('promo code redemption', () => {
    /** A paid tier, so a discount is visible in the total. */
    const sellableEvent = async (priceMinor: bigint) => {
      const type = await prisma.ticketType.create({
        data: { eventId, name: { en: 'GA' }, priceMinor, quantityTotal: 50, maxPerOrder: 50 },
      });
      await prisma.event.update({ where: { id: eventId }, data: { visibility: 'PUBLIC' } });
      const listing = await prisma.eventListing.create({
        data: {
          eventId,
          slug: `p-${Math.random().toString(36).slice(2, 8)}`,
          publishedAt: new Date(),
        },
      });
      return { ticketTypeId: type.id, slug: listing.slug };
    };

    const promo = (code: string, maxRedemptions: number | null) =>
      prisma.promoCode.create({
        data: {
          organizationId,
          code,
          kind: DiscountKind.PERCENT,
          value: 50n,
          maxRedemptions,
        },
      });

    const order = (slug: string, ticketTypeId: string, promoCode?: string) =>
      ticketing.createOrder(slug, {
        items: [{ ticketTypeId, quantity: 1 }],
        buyerName: 'Buyer',
        buyerEmail: 'buyer@test.local',
        idempotencyKey: `order-${Math.random()}`,
        provider: PaymentProvider.FAKE,
        promoCode,
      });

    it('takes the discount off the total and records what was given', async () => {
      const { slug, ticketTypeId } = await sellableEvent(10_000n);
      await promo('HALF', null);

      const created = await order(slug, ticketTypeId, 'half');

      expect(created.totalMinor).toBe('5000');
      expect(created.discountMinor).toBe('5000');
      const row = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: created.orderId } });
      expect(row.discountMinor).toBe(5_000n);
      expect(row.promoCodeId).not.toBeNull();
    });

    /**
     * The failure this guards: two buyers with the last redemption of a code.
     * Counting in Node after a read would let both through and hand out a
     * discount the host never offered.
     */
    it('redeems a single-use code exactly once under concurrency', async () => {
      const { slug, ticketTypeId } = await sellableEvent(10_000n);
      const code = await promo('ONCE', 1);

      const results = await Promise.allSettled([
        order(slug, ticketTypeId, 'ONCE'),
        order(slug, ticketTypeId, 'ONCE'),
        order(slug, ticketTypeId, 'ONCE'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      // The database CHECK constraint also protects the limit, so the count
      // would stay correct even if the claim were wrong — but the loser would
      // get a 500 instead of "this code has just run out". Asserting the
      // error kind is what distinguishes a guarded claim from a lucky one.
      for (const result of results.filter((r) => r.status === 'rejected')) {
        const reason = (result).reason as { status?: number };
        expect(reason.status).toBeGreaterThanOrEqual(400);
        expect(reason.status).toBeLessThan(500);
      }
      const after = await prisma.promoCode.findUniqueOrThrow({ where: { id: code.id } });
      expect(after.redemptions).toBe(1);
      expect(await prisma.ticketOrder.count({ where: { promoCodeId: code.id } })).toBe(1);
    });

    // Inventory must not be left held by a checkout the discount rejected.
    it('holds no inventory when the code is refused', async () => {
      const { slug, ticketTypeId } = await sellableEvent(10_000n);
      await promo('SPENT', 1);
      await order(slug, ticketTypeId, 'SPENT');

      await expect(order(slug, ticketTypeId, 'SPENT')).rejects.toThrow();

      const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
      expect(type.quantityReserved).toBe(1);
    });

    it('gives the redemption back when the checkout is abandoned', async () => {
      const { slug, ticketTypeId } = await sellableEvent(10_000n);
      const code = await promo('ONCE', 1);
      const created = await order(slug, ticketTypeId, 'ONCE');
      await prisma.ticketOrder.update({
        where: { id: created.orderId },
        data: { reservesUntil: new Date(Date.now() - 1_000) },
      });

      await ticketing.releaseExpiredReservations();

      const after = await prisma.promoCode.findUniqueOrThrow({ where: { id: code.id } });
      expect(after.redemptions).toBe(0);
      const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
      expect(type.quantityReserved).toBe(0);
    });

    /**
     * Two sweeps running at once — the cron on one instance and the endpoint
     * called by hand — must not return the same seats twice.
     */
    it('expires an abandoned order once, however many sweeps run', async () => {
      const { slug, ticketTypeId } = await sellableEvent(10_000n);
      const code = await promo('ONCE', 1);
      const created = await order(slug, ticketTypeId, 'ONCE');
      await prisma.ticketOrder.update({
        where: { id: created.orderId },
        data: { reservesUntil: new Date(Date.now() - 1_000) },
      });

      const sweeps = await Promise.allSettled([
        ticketing.releaseExpiredReservations(),
        ticketing.releaseExpiredReservations(),
        ticketing.releaseExpiredReservations(),
      ]);

      const released = sweeps
        .filter((r): r is PromiseFulfilledResult<{ released: number }> => r.status === 'fulfilled')
        .reduce((sum, r) => sum + r.value.released, 0);
      expect(released).toBe(1);

      const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
      expect(type.quantityReserved).toBe(0);
      const after = await prisma.promoCode.findUniqueOrThrow({ where: { id: code.id } });
      expect(after.redemptions).toBe(0);
    });
  });

  describe('telling the buyer', () => {
    /**
     * A buyer paid, tickets were issued, and they received nothing. The only
     * way to reach them was the access token in the checkout response, which
     * a browser that navigated away had already lost — and the
     * `ticket.issued` copy had been seeded since the outbox was built with
     * nothing ever sending it.
     */
    const paidOrderWithCopy = async (quantity: number) => {
      await prisma.messageTemplate.create({
        data: {
          organizationId,
          key: 'ticket.issued',
          channel: MessageChannel.EMAIL,
          subject: { hy: 'Ձեր տոմսերը' },
          body: { hy: '{{buyerName}} — {{link}}' },
        },
      });

      const type = await prisma.ticketType.create({
        data: { eventId, name: { en: 'GA' }, priceMinor: 0n, quantityTotal: 50, maxPerOrder: 50 },
      });
      await prisma.event.update({ where: { id: eventId }, data: { visibility: 'PUBLIC' } });
      const listing = await prisma.eventListing.create({
        data: {
          eventId,
          slug: `n-${Math.random().toString(36).slice(2, 8)}`,
          publishedAt: new Date(),
        },
      });

      return ticketing.createOrder(listing.slug, {
        items: [{ ticketTypeId: type.id, quantity }],
        buyerName: 'Ani Grigoryan',
        buyerEmail: 'buyer@test.local',
        idempotencyKey: `order-${Math.random()}`,
      });
    };

    const ticketMail = () =>
      prisma.message.findMany({ where: { templateKey: 'ticket.issued' } });

    it('queues the tickets to the buyer when they are issued', async () => {
      await paidOrderWithCopy(2);

      const mail = await ticketMail();
      expect(mail).toHaveLength(1);
      expect(mail[0].toAddress).toBe('buyer@test.local');
      expect(mail[0].body).toContain('Ani Grigoryan');
      expect(mail[0].body).toContain('/tickets/');
    });

    /**
     * Settlement is deliberately idempotent, so it runs again on a retried
     * callback and a refreshed return page. The confirmation must not.
     */
    it('sends one confirmation however many times settlement runs', async () => {
      const order = await paidOrderWithCopy(1);

      await Promise.allSettled([
        ticketing.markPaid(order.orderId),
        ticketing.markPaid(order.orderId),
        ticketing.markPaid(order.orderId),
      ]);

      expect(await ticketMail()).toHaveLength(1);
    });

    /**
     * The money has moved and the tickets exist. Failing settlement because
     * an email could not be queued would leave a paid order unsettled, which
     * is far worse than a buyer who has to be sent their link by hand.
     */
    it('still issues the tickets when the copy is missing', async () => {
      const type = await prisma.ticketType.create({
        data: { eventId, name: { en: 'GA' }, priceMinor: 0n, quantityTotal: 10, maxPerOrder: 10 },
      });
      await prisma.event.update({ where: { id: eventId }, data: { visibility: 'PUBLIC' } });
      const listing = await prisma.eventListing.create({
        data: {
          eventId,
          slug: `m-${Math.random().toString(36).slice(2, 8)}`,
          publishedAt: new Date(),
        },
      });

      const order = await ticketing.createOrder(listing.slug, {
        items: [{ ticketTypeId: type.id, quantity: 2 }],
        buyerName: 'Ani',
        buyerEmail: 'buyer@test.local',
        idempotencyKey: `order-${Math.random()}`,
      });

      expect(order.status).toBe(TicketOrderStatus.PAID);
      expect(await prisma.ticket.count({ where: { orderId: order.orderId } })).toBe(2);
      expect(await ticketMail()).toHaveLength(0);
    });
  });


  /**
   * Cancelling refunds, and refunding cancels — decided with the product
   * owner, because refunding the money alone left a buyer refunded and still
   * able to get in. These are the cases that cannot be apologised away: a
   * double payout, or a refunded ticket that still opens the door.
   */
  describe('cancelling a paid order', () => {
    /** A paid, settled order for `quantity` tickets at `priceMinor` each. */
    const paidTicketOrder = async (quantity: number, priceMinor = 10_000n) => {
      const type = await prisma.ticketType.create({
        data: { eventId, name: { en: 'GA' }, priceMinor, quantityTotal: 50, maxPerOrder: 50 },
      });
      await prisma.event.update({ where: { id: eventId }, data: { visibility: 'PUBLIC' } });
      const listing = await prisma.eventListing.create({
        data: { eventId, slug: `c-${Math.random().toString(36).slice(2, 8)}`, publishedAt: new Date() },
      });

      const created = await ticketing.createOrder(listing.slug, {
        items: [{ ticketTypeId: type.id, quantity }],
        buyerName: 'Ani',
        buyerEmail: 'buyer@test.local',
        idempotencyKey: `order-${Math.random()}`,
        provider: PaymentProvider.FAKE,
      });

      if (priceMinor > 0n) {
        const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: created.orderId } });
        const payment = await prisma.payment.findUniqueOrThrow({
          where: { orderNumber: order.paymentOrderNumber! },
        });
        fake.simulateSuccess(payment.providerRef!);
        await ticketing.confirmOrder(order.accessToken);
      }

      return { orderId: created.orderId, ticketTypeId: type.id };
    };

    it('refunds the payment and voids every ticket', async () => {
      const { orderId } = await paidTicketOrder(3);

      const result = await cancellation.cancel(eventId, orderId);

      expect(result.status).toBe(TicketOrderStatus.REFUNDED);
      expect(result.tickets.every((ticket) => ticket.status === 'VOID')).toBe(true);
      const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId } });
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: order.paymentOrderNumber! },
      });
      expect(payment.refundedMinor).toBe(30_000n);
    });

    // The seats exist again and someone else can buy them.
    it('puts the seats back on sale', async () => {
      const { orderId, ticketTypeId } = await paidTicketOrder(3);

      await cancellation.cancel(eventId, orderId);

      const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
      expect(type.quantitySold).toBe(0);
    });

    /**
     * The failure this exists to prevent: two hosts, or one host clicking
     * twice, paying the buyer back twice.
     */
    it('refunds exactly once under concurrent cancellations', async () => {
      const { orderId, ticketTypeId } = await paidTicketOrder(2);

      await Promise.allSettled([
        cancellation.cancel(eventId, orderId),
        cancellation.cancel(eventId, orderId),
        cancellation.cancel(eventId, orderId),
      ]);

      const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId } });
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: order.paymentOrderNumber! },
      });
      expect(payment.refundedMinor).toBe(20_000n);
      expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
      // Seats returned once, not three times.
      const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
      expect(type.quantitySold).toBe(0);
    });

    /**
     * The process dies after the bank refunded and before the tickets were
     * voided: money back, tickets still valid. Running the cancellation again
     * must finish the job — not refund a second time, and not refuse.
     */
    it('finishes a cancellation that died after refunding', async () => {
      const { orderId } = await paidTicketOrder(2);
      const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId } });
      await payments.refund(order.paymentOrderNumber!, 20_000n);

      const result = await cancellation.cancel(eventId, orderId);

      expect(result.status).toBe(TicketOrderStatus.REFUNDED);
      expect(result.tickets.every((ticket) => ticket.status === 'VOID')).toBe(true);
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: order.paymentOrderNumber! },
      });
      expect(payment.refundedMinor).toBe(20_000n);
    });

    it('answers a second cancellation rather than refusing it', async () => {
      const { orderId } = await paidTicketOrder(1);
      await cancellation.cancel(eventId, orderId);

      await expect(cancellation.cancel(eventId, orderId)).resolves.toMatchObject({
        status: TicketOrderStatus.REFUNDED,
      });
    });

    /**
     * Someone with one of these tickets was already let in. Refunding after
     * attendance is a dispute, and voiding a used ticket would erase the
     * record that they came.
     */
    it('refuses an order with a ticket already admitted, and changes nothing', async () => {
      const { orderId } = await paidTicketOrder(2);
      const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
      await ticketing.admit(eventId, ticket.code);

      await expect(cancellation.cancel(eventId, orderId)).rejects.toThrow(/already admitted/);

      const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId } });
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: order.paymentOrderNumber! },
      });
      expect(order.status).toBe(TicketOrderStatus.PAID);
      expect(payment.refundedMinor).toBe(0n);
    });

    it('cancels a free order without touching any payment', async () => {
      const { orderId } = await paidTicketOrder(2, 0n);

      const result = await cancellation.cancel(eventId, orderId);

      expect(result.status).toBe(TicketOrderStatus.CANCELLED);
      expect(result.tickets.every((ticket) => ticket.status === 'VOID')).toBe(true);
    });

    // A ticket voided by cancellation must not open the door.
    it('makes a cancelled ticket unusable at the door', async () => {
      const { orderId } = await paidTicketOrder(1);
      const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });

      await cancellation.cancel(eventId, orderId);

      await expect(ticketing.admit(eventId, ticket.code)).rejects.toThrow();
    });

    it('refuses an order from a different event', async () => {
      const { orderId } = await paidTicketOrder(1);

      await expect(cancellation.cancel('some-other-event', orderId)).rejects.toThrow(/No such order/);
    });
  });

  describe('refunding a ticket payment directly', () => {
    /**
     * The other half of the rule: the raw refund endpoint refuses ticket
     * payments, so the only way to refund one is the cancellation that also
     * voids its tickets.
     */
    it('is refused, pointing at cancellation instead', async () => {
      const type = await prisma.ticketType.create({
        data: { eventId, name: { en: 'GA' }, priceMinor: 10_000n, quantityTotal: 10, maxPerOrder: 10 },
      });
      await prisma.event.update({ where: { id: eventId }, data: { visibility: 'PUBLIC' } });
      const listing = await prisma.eventListing.create({
        data: { eventId, slug: `r-${Math.random().toString(36).slice(2, 8)}`, publishedAt: new Date() },
      });
      const created = await ticketing.createOrder(listing.slug, {
        items: [{ ticketTypeId: type.id, quantity: 1 }],
        buyerName: 'Ani',
        buyerEmail: 'buyer@test.local',
        idempotencyKey: `order-${Math.random()}`,
        provider: PaymentProvider.FAKE,
      });
      const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: created.orderId } });

      await expect(
        payments.refundNonTicket(order.paymentOrderNumber!, 10_000n),
      ).rejects.toThrow(/Cancel the ticket order instead/);
    });

    it('still refunds a payment that is not for tickets', async () => {
      const orderNumber = await capturedPayment();

      await expect(payments.refundNonTicket(orderNumber, 10_000n)).resolves.toBeDefined();
    });
  });

});