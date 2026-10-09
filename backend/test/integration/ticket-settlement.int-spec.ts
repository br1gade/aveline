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
    const fulfilment = new TicketFulfilmentService(database, inventory, promoCodes, notifier);
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
