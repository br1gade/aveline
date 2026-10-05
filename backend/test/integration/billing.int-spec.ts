import { PaymentProvider, PlanTier, PrismaClient, SubscriptionStatus } from '@prisma/client';
import { nextInvoiceSequence } from '../../src/modules/billing/invoice-number';
import { SubscriptionsService } from '../../src/modules/billing/subscriptions.service';
import { PaymentGatewayRegistry } from '../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { FakeGateway } from '../../src/modules/payments/providers/fake.gateway';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Billing against real Postgres, because every property worth testing here is
 * a property of the database: a gap-free numbered series, and a subscription
 * that activates exactly once however many callbacks arrive.
 */
describe('billing (integration)', () => {
  let prisma: PrismaClient;
  let subscriptions: SubscriptionsService;
  let fake: FakeGateway;
  let organizationId: string;

  beforeAll(() => {
    prisma = testPrisma();
    fake = new FakeGateway();
    const payments = new PaymentsService(
      prisma as unknown as PrismaService,
      new PaymentGatewayRegistry([fake]),
    );
    subscriptions = new SubscriptionsService(prisma as unknown as PrismaService, payments);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    const seeded = await seedEvent(prisma);
    organizationId = (
      await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } })
    ).organizationId;
  });

  afterAll(() => disconnectTestDatabase());

  const plan = (overrides: { key: string; priceMinor: bigint }) =>
    prisma.plan.create({
      data: {
        key: overrides.key,
        name: `Plan ${overrides.key}`,
        tier: PlanTier.MANAGED,
        priceMinor: overrides.priceMinor,
        interval: 'MONTHLY',
      },
    });

  describe('invoice numbering', () => {
    const takeNumber = (series: string) =>
      prisma.$transaction((tx) => nextInvoiceSequence(tx, series));

    it('starts a series at one and counts up', async () => {
      expect(await takeNumber('2026')).toBe(1);
      expect(await takeNumber('2026')).toBe(2);
      expect(await takeNumber('2026')).toBe(3);
    });

    it('keeps series independent', async () => {
      await takeNumber('2026');
      expect(await takeNumber('2027')).toBe(1);
    });

    /**
     * The reason this is a counter row and not a Postgres sequence. `nextval`
     * is non-transactional, so an invoice that fails to write would burn its
     * number and leave a gap — which is the thing a tax audit asks about.
     */
    it('returns the number when the invoice that took it rolls back', async () => {
      await takeNumber('2026');

      await expect(
        prisma.$transaction(async (tx) => {
          await nextInvoiceSequence(tx, '2026');
          throw new Error('invoice failed to write');
        }),
      ).rejects.toThrow('invoice failed to write');

      expect(await takeNumber('2026')).toBe(2);
    });

    // Two issuers must never be handed one number: it would put two sales on
    // one filed document.
    it('hands out each number once under concurrency', async () => {
      const taken = await Promise.all(
        Array.from({ length: 10 }, () => takeNumber('2026')),
      );

      expect([...taken].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  describe('subscribing', () => {
    it('activates a free plan immediately, with no invoice', async () => {
      await plan({ key: 'free', priceMinor: 0n });

      const result = await subscriptions.subscribe(organizationId, { planKey: 'free' });

      expect(result.subscription.status).toBe(SubscriptionStatus.ACTIVE);
      expect(result.invoice).toBeNull();
      expect(await prisma.invoice.count({ where: { organizationId } })).toBe(0);
    });

    // Access must not begin on an unpaid intent.
    it('leaves a paid plan inactive until its invoice is paid', async () => {
      await plan({ key: 'managed', priceMinor: 25_000n });

      const result = await subscriptions.subscribe(organizationId, {
        planKey: 'managed',
        provider: PaymentProvider.FAKE,
      });

      expect(result.subscription.status).toBe(SubscriptionStatus.TRIALING);
      expect(result.invoice?.number).toMatch(/^AV-\d{4}-\d{6}$/);
      expect(result.invoice?.status).toBe('ISSUED');
      expect(result.payment?.redirectUrl).toEqual(expect.any(String));
      // The client confirms by invoice number, so the returned invoice must
      // already carry the payment it was linked to.
      expect(result.invoice?.paymentOrderNumber).toBe(result.payment?.orderNumber);
    });

    it('activates on payment and does so exactly once', async () => {
      await plan({ key: 'managed', priceMinor: 25_000n });
      const { invoice } = await subscriptions.subscribe(organizationId, {
        planKey: 'managed',
        provider: PaymentProvider.FAKE,
      });
      fake.simulateSuccess(`fake_${invoice!.paymentOrderNumber}`);

      const settled = await Promise.allSettled([
        subscriptions.confirmPayment(organizationId, invoice!.number),
        subscriptions.confirmPayment(organizationId, invoice!.number),
        subscriptions.confirmPayment(organizationId, invoice!.number),
      ]);

      expect(settled.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      const paid = await prisma.invoice.findFirstOrThrow({ where: { number: invoice!.number } });
      expect(paid.status).toBe('PAID');
      expect(paid.paidAt).not.toBeNull();

      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE);
    });

    it('changes plan in place rather than opening a second subscription', async () => {
      await plan({ key: 'free', priceMinor: 0n });
      await plan({ key: 'free-2', priceMinor: 0n });

      await subscriptions.subscribe(organizationId, { planKey: 'free' });
      await subscriptions.subscribe(organizationId, { planKey: 'free-2' });

      expect(await prisma.subscription.count({ where: { organizationId } })).toBe(1);
      const { subscription } = await subscriptions.current(organizationId);
      expect(subscription?.plan.key).toBe('free-2');
    });

    it('refuses a paid plan with no provider', async () => {
      await plan({ key: 'managed', priceMinor: 25_000n });

      await expect(
        subscriptions.subscribe(organizationId, { planKey: 'managed' }),
      ).rejects.toThrow(/provider/);
    });
  });

  describe('cancelling', () => {
    // A customer who paid for the month keeps the month.
    it('keeps access until the end of the paid period', async () => {
      await plan({ key: 'free', priceMinor: 0n });
      await subscriptions.subscribe(organizationId, { planKey: 'free' });

      const cancelled = await subscriptions.cancel(organizationId);

      expect(cancelled.cancelAtPeriodEnd).toBe(true);
      expect(cancelled.status).toBe(SubscriptionStatus.ACTIVE);
      expect(cancelled.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    });

    it('can be undone before the period ends', async () => {
      await plan({ key: 'free', priceMinor: 0n });
      await subscriptions.subscribe(organizationId, { planKey: 'free' });
      await subscriptions.cancel(organizationId);

      const resumed = await subscriptions.resume(organizationId);

      expect(resumed.cancelAtPeriodEnd).toBe(false);
      expect(resumed.cancelledAt).toBeNull();
    });
  });
});
