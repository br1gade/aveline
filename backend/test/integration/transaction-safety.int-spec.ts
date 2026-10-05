import { PaymentEventSource, PaymentProvider, PaymentPurpose, PaymentStatus, PrismaClient, TicketOrderStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PaymentGatewayRegistry } from '../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { FakeGateway } from '../../src/modules/payments/providers/fake.gateway';
import { TicketInventoryService } from '../../src/modules/ticketing/ticket-inventory.service';
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
    ticketing = new TicketingService(prisma as unknown as PrismaService, inventory, payments);
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
});
