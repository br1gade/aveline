import {
  DiscountKind,
  PaymentEventSource,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  PrismaClient,
  TicketOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PaymentGatewayRegistry } from '../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { FakeGateway } from '../../src/modules/payments/providers/fake.gateway';
import { TicketInventoryService } from '../../src/modules/ticketing/ticket-inventory.service';
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
    ticketing = new TicketingService(
      prisma as unknown as PrismaService,
      inventory,
      payments,
      promoCodes,
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
});
