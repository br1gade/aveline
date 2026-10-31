import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { DiscountKind, MessageChannel, PaymentProvider, PaymentPurpose, PaymentStatus, PlanTier, BillingInterval, PrismaClient, RefundStatus, TicketOrderStatus } from '@prisma/client';
import { ConsoleTransport } from '../../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { SuppressionService } from '../../../src/modules/communications/suppression.service';
import { TicketNotifierService } from '../../../src/modules/ticketing/ticket-notifier.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, TEST_DATABASE_URL, testPrisma } from '../../setup/test-database';

/**
 * Money invariants GOING_LIVE.md §3 says the database enforces, tried against
 * the database itself; and the sweep behind PAYMENTS.md "Confirmation emails
 * cannot be lost" for the cancelled and refunded orders it also promises.
 */
describe('critique gaps (integration coverage)', () => {
  let prisma: PrismaClient;

  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  const organization = () => prisma.organization.create({ data: { name: 'Money Org', kind: 'HOST' } });

  const capturedPayment = async (organizationId: string) => prisma.payment.create({
    data: { organizationId, purpose: PaymentPurpose.TICKET, provider: PaymentProvider.FAKE, orderNumber: `AVL-${randomUUID()}`, amountMinor: 10_000n,
      status: PaymentStatus.CAPTURED, returnUrl: 'https://aveline.test/return', idempotencyKey: randomUUID() },
  });

  const ticketOrder = (eventId: string, data: { status?: TicketOrderStatus; paymentOrderNumber?: string | null; discountMinor?: bigint } = {}) =>
    prisma.ticketOrder.create({
      data: { eventId, buyerName: 'Ani', buyerEmail: 'buyer@test.local', totalMinor: 10_000n, idempotencyKey: randomUUID(), accessToken: randomUUID(),
        status: data.status ?? TicketOrderStatus.RESERVED, paymentOrderNumber: data.paymentOrderNumber ?? null, discountMinor: data.discountMinor ?? 0n },
    });

  describe('the money constraints the database enforces', () => {
    /** Each row is created at its smallest legal value; the statement moves it one below. */
    const CASES = [
      { constraint: 'refunds_amount_positive', smallest: '1', create: async () => {
        const payment = await capturedPayment((await organization()).id);
        const refund = await prisma.refund.create({ data: { paymentId: payment.id, amountMinor: 1n } });
        return `UPDATE refunds SET "amountMinor" = 0 WHERE id = '${refund.id}'`;
      } },
      { constraint: 'ticket_orders_discount_non_negative', smallest: '0', create: async () => {
        const order = await ticketOrder((await seedEvent(prisma)).eventId, { discountMinor: 0n });
        return `UPDATE ticket_orders SET "discountMinor" = -1 WHERE id = '${order.id}'`;
      } },
      { constraint: 'promo_codes_value_positive', smallest: '1', create: async () => {
        const code = await prisma.promoCode.create({ data: { organizationId: (await organization()).id, code: 'ONE', kind: DiscountKind.FIXED, value: 1n } });
        return `UPDATE promo_codes SET value = 0 WHERE id = '${code.id}'`;
      } },
      { constraint: 'plans_price_non_negative', smallest: '0', create: async () => {
        const plan = await prisma.plan.create({ data: { key: 'free', name: 'Free', tier: PlanTier.INVITATION, priceMinor: 0n, interval: BillingInterval.PER_EVENT } });
        return `UPDATE plans SET "priceMinor" = -1 WHERE id = '${plan.id}'`;
      } },
      { constraint: 'invoice_counters_next_positive', smallest: '1', create: async () => {
        await prisma.invoiceCounter.create({ data: { series: '2026', next: 1 } });
        return `UPDATE invoice_counters SET next = 0 WHERE series = '2026'`;
      } },
    ];

    it.each(CASES)('$constraint accepts $smallest and refuses one below it', async ({ constraint, create }) => {
      const belowSmallest = await create();

      await expect(prisma.$executeRawUnsafe(belowSmallest)).rejects.toThrow(constraint);
    });
  });

  it('describes in prisma/schema.prisma the database the migrations build, so a generated migration drops nothing', async () => {
    const run = promisify(execFile);
    const { stdout } = await run('npx', ['prisma', 'migrate', 'diff', '--from-url', TEST_DATABASE_URL,
      '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], { cwd: join(__dirname, '..', '..', '..') });

    expect(stdout.split('\n').filter((line) => /^(ALTER|DROP|CREATE)/.test(line))).toEqual([]);
  }, 60_000);

  describe('recovering lost cancellation and refund notices', () => {
    let notifier: TicketNotifierService;

    beforeAll(() => {
      const database = prisma as unknown as PrismaService;
      const transports = new Map<MessageChannel, MessageTransport>(Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]));
      notifier = new TicketNotifierService(database, new CommunicationsService(database, transports, new SuppressionService(database)),
        { get: () => 'https://aveline.test' } as unknown as ConfigService);
    });

    const cancellationCopy = (organizationId: string | null) => prisma.messageTemplate.create({
      data: { organizationId, key: 'ticket.cancelled', channel: MessageChannel.EMAIL, subject: { hy: 'Չեղարկված' }, body: { hy: '{{buyerName}} {{amount}}' } },
    });

    const noticesFor = (orderId: string) => prisma.message.findMany({ where: { dedupeKey: `ticket-cancelled:${orderId}` } });

    it('tells the buyer of a cancelled order whose notice was never queued, once', async () => {
      await cancellationCopy(null);
      const order = await ticketOrder((await seedEvent(prisma)).eventId, { status: TicketOrderStatus.CANCELLED });

      await notifier.sendMissing();
      const second = await notifier.sendMissing();

      const notices = await noticesFor(order.id);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ templateKey: 'ticket.cancelled', toAddress: 'buyer@test.local', channel: MessageChannel.EMAIL });
      expect(second).toEqual({ queued: 0 });
    });

    it('tells the buyer of a refunded order once the bank has completed the refund', async () => {
      await cancellationCopy(null);
      const seeded = await seedEvent(prisma);
      const { organizationId } = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
      const payment = await capturedPayment(organizationId);
      await prisma.refund.create({ data: { paymentId: payment.id, amountMinor: 10_000n, status: RefundStatus.COMPLETED, completedAt: new Date() } });
      const order = await ticketOrder(seeded.eventId, { status: TicketOrderStatus.REFUNDED, paymentOrderNumber: payment.orderNumber });

      await notifier.sendMissing();

      expect(await noticesFor(order.id)).toHaveLength(1);
    });

    it('does not reach back past a week', async () => {
      await cancellationCopy(null);
      const order = await ticketOrder((await seedEvent(prisma)).eventId, { status: TicketOrderStatus.CANCELLED });
      await prisma.$executeRaw`UPDATE ticket_orders SET "updatedAt" = now() - interval '8 days' WHERE id = ${order.id}`;

      await notifier.sendMissing();

      expect(await noticesFor(order.id)).toHaveLength(0);
    });
  });
});
