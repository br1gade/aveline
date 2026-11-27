import { BillingInterval, PaymentProvider, PlanTier, PrismaClient, SubscriptionStatus } from '@prisma/client';
import { captureInvitationLifetime } from '../../src/modules/invitations/lifetime';
import { applyDueRenewal, settleRenewal } from '../../src/modules/billing/renewal-state';
import { lockBillingOrganization } from '../../src/modules/billing/scheduled-free';
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
  let payments: PaymentsService;
  let organizationId: string;

  beforeAll(() => {
    prisma = testPrisma();
    fake = new FakeGateway();
    payments = new PaymentsService(
      prisma as unknown as PrismaService,
      new PaymentGatewayRegistry([fake]),
    );
    subscriptions = new SubscriptionsService(prisma as unknown as PrismaService, payments);
    subscriptions.onModuleInit();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    const seeded = await seedEvent(prisma);
    organizationId = (
      await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } })
    ).organizationId;
  });

  afterAll(() => disconnectTestDatabase());

  const plan = (overrides: { key: string; priceMinor: bigint; interval?: BillingInterval }) =>
    prisma.plan.create({
      data: {
        key: overrides.key,
        name: `Plan ${overrides.key}`,
        tier: PlanTier.MANAGED,
        priceMinor: overrides.priceMinor,
        interval: overrides.interval ?? 'MONTHLY',
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
    it.each([PaymentProvider.AMERIABANK, PaymentProvider.INECOBANK, PaymentProvider.IDBANK])(
      'refuses unconfigured %s before issuing a first invoice or consuming a number',
      async (provider) => {
        await plan({ key: 'managed', priceMinor: 25_000n });
        await expect(subscriptions.subscribe(organizationId, { planKey: 'managed', provider }))
          .rejects.toThrow(`${provider} is not configured`);
        expect(await prisma.invoice.count()).toBe(0);
        expect(await prisma.invoiceCounter.count()).toBe(0);
        expect(await prisma.subscription.count()).toBe(0);
        expect(await prisma.payment.count()).toBe(0);
      },
    );

    it.each([PaymentProvider.AMERIABANK, PaymentProvider.INECOBANK, PaymentProvider.IDBANK])(
      'keeps the current subscription and payable invoice when %s is unconfigured',
      async (provider) => {
        await plan({ key: 'free', priceMinor: 0n });
        await plan({ key: 'managed', priceMinor: 25_000n });
        await plan({ key: 'production', priceMinor: 50_000n });
        await subscriptions.subscribe(organizationId, { planKey: 'free' });
        await subscriptions.subscribe(organizationId, { planKey: 'managed', provider: PaymentProvider.FAKE });
        const subscription = await prisma.subscription.findUniqueOrThrow({ where: { organizationId } });
        const invoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId } });
        const counters = await prisma.invoiceCounter.findMany();
        await expect(subscriptions.subscribe(organizationId, { planKey: 'production', provider }))
          .rejects.toThrow(`${provider} is not configured`);
        expect(await prisma.subscription.findUniqueOrThrow({ where: { organizationId } })).toEqual(subscription);
        expect(await prisma.invoice.findMany({ where: { organizationId } })).toEqual([invoice]);
        expect(await prisma.invoiceCounter.findMany()).toEqual(counters);
        expect(await prisma.payment.count()).toBe(1);
      },
    );

    it('refuses paid pilot plans before issuing an invoice and still permits a free plan', async () => {
      await plan({ key: 'paid', priceMinor: 25_000n });
      await plan({ key: 'free', priceMinor: 0n });
      const previous = process.env.PILOT_MODE;
      process.env.PILOT_MODE = 'true';
      try {
        await expect(subscriptions.subscribe(organizationId, { planKey: 'paid', provider: PaymentProvider.FAKE })).rejects.toThrow('Payments are disabled for the free pilot');
        expect(await prisma.invoice.count()).toBe(0);
        expect(await prisma.payment.count()).toBe(0);
        const result = await subscriptions.subscribe(organizationId, { planKey: 'free' });
        expect(result.subscription?.status).toBe(SubscriptionStatus.ACTIVE);
      } finally {
        if (previous === undefined) delete process.env.PILOT_MODE;
        else process.env.PILOT_MODE = previous;
      }
    });
    it('activates a free plan immediately, with no invoice', async () => {
      await plan({ key: 'free', priceMinor: 0n });

      const result = await subscriptions.subscribe(organizationId, { planKey: 'free' });

      expect(result.subscription?.status).toBe(SubscriptionStatus.ACTIVE);
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

      // B85: a first paid plan used to create a TRIALING subscription on the
      // paid plan, so GET /subscription reported its entitlements unpaid.
      expect(result.subscription).toBeNull();
      expect((await subscriptions.current(organizationId)).subscription).toBeNull();
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

  // B39: changing plan overwrote the one subscription row before anything
  // was paid, so paying an old invoice activated whatever plan it now held,
  // and abandoning a change dropped an active customer to trial.
  describe('changing plan', () => {
    const subscribeTo = (planKey: string) =>
      subscriptions.subscribe(organizationId, { planKey, provider: PaymentProvider.FAKE });
    const payAtTheBank = (invoice: { paymentOrderNumber: string | null }) => fake.simulateSuccess(`fake_${invoice.paymentOrderNumber}`);
    const activeOn = async (planKey: string) => {
      const { invoice } = await subscribeTo(planKey);
      payAtTheBank(invoice!);
      await subscriptions.confirmPayment(organizationId, invoice!.number);
    };

    beforeEach(async () => {
      await plan({ key: 'basic', priceMinor: 10_000n });
      await plan({ key: 'pro', priceMinor: 50_000n });
    });

    it('keeps paid access until the scheduled Free boundary and activates the selected Free terms once', async () => {
      await plan({ key: 'free', priceMinor: 0n, interval: BillingInterval.PER_EVENT });
      await activeOn('basic');
      const paid = (await subscriptions.current(organizationId)).subscription!;
      const result = await subscriptions.subscribe(organizationId, { planKey: 'free' });
      expect(result.subscription).toMatchObject({ plan: { key: 'basic' },
        pendingFree: { planKey: 'free', effectiveAt: paid.currentPeriodEnd } });
      const { invoice } = await subscribeTo('pro');
      expect((await subscriptions.current(organizationId)).subscription?.pendingFree?.planKey).toBe('free');
      await prisma.plan.update({ where: { key: 'free' }, data: { name: 'Renamed', priceMinor: 100n } });
      await subscriptions.applyDueFreeChanges(paid.currentPeriodEnd);
      await subscriptions.applyDueFreeChanges(paid.currentPeriodEnd);
      const free = (await subscriptions.current(organizationId)).subscription!;
      expect(free).toMatchObject({ plan: { key: 'free', priceMinor: '0' },
        currentPeriodStart: paid.currentPeriodEnd, pendingFree: null });
      payAtTheBank(invoice!);
      await subscriptions.confirmPayment(organizationId, invoice!.number);
      expect((await subscriptions.current(organizationId)).subscription?.plan.key).toBe('pro');
    });

    it('supersedes the pending Free switch only on captured payment before the boundary', async () => {
      await plan({ key: 'free', priceMinor: 0n });
      await activeOn('basic');
      const { subscription } = await subscriptions.subscribe(organizationId, { planKey: 'free' });
      const { invoice } = await subscribeTo('pro');
      await subscriptions.subscribe(organizationId, { planKey: 'free' });
      expect((await subscriptions.findInvoice(organizationId, invoice!.number)).status).toBe('ISSUED');
      payAtTheBank(invoice!);
      await subscriptions.confirmPayment(organizationId, invoice!.number);
      await subscriptions.applyDueFreeChanges(subscription!.currentPeriodEnd);
      expect((await subscriptions.current(organizationId)).subscription)
        .toMatchObject({ plan: { key: 'pro' }, pendingFree: null });
    });

    it('withdraws a Free switch before the boundary without extending the paid period', async () => {
      await plan({ key: 'free', priceMinor: 0n });
      await activeOn('basic');
      const paid = (await subscriptions.current(organizationId)).subscription!;
      await subscriptions.subscribe(organizationId, { planKey: 'free' });
      const withdrawn = await subscriptions.withdrawFreeChange(organizationId);
      expect(withdrawn).toMatchObject({ plan: { key: 'basic' }, pendingFree: null, currentPeriodEnd: paid.currentPeriodEnd });
      await subscriptions.applyDueFreeChanges(paid.currentPeriodEnd);
      expect((await subscriptions.current(organizationId)).subscription?.plan.key).toBe('basic');
    });

    // B76: a double click issued two open invoices, both payable.
    it('issues one invoice for a double-clicked subscribe, and returns it to both', async () => {
      const [first, second] = await Promise.all([subscribeTo('pro'), subscribeTo('pro')]);

      expect(second.invoice?.number).toBe(first.invoice?.number);
      expect(second.payment?.orderNumber).toBe(first.payment?.orderNumber);
      expect(await prisma.invoice.count({ where: { organizationId, status: 'ISSUED' } })).toBe(1);
    });

    it('keeps the current plan active until the new one is paid', async () => {
      await activeOn('basic');

      await subscribeTo('pro');

      const { subscription } = await subscriptions.current(organizationId);
      expect(subscription).toMatchObject({ status: SubscriptionStatus.ACTIVE, plan: { key: 'basic' } });
    });

    it('moves to the new plan when its invoice is paid', async () => {
      await activeOn('basic');
      const { invoice } = await subscribeTo('pro');
      payAtTheBank(invoice!);

      await subscriptions.confirmPayment(organizationId, invoice!.number);

      const { subscription } = await subscriptions.current(organizationId);
      expect(subscription).toMatchObject({ status: SubscriptionStatus.ACTIVE, plan: { key: 'pro' } });
    });

    it('voids the older open invoice, and refunds it if it is paid anyway', async () => {
      const { invoice: cheap } = await subscribeTo('basic');
      await subscribeTo('pro');
      payAtTheBank(cheap!);

      await subscriptions.confirmPayment(organizationId, cheap!.number);

      const old = await prisma.invoice.findFirstOrThrow({ where: { number: cheap!.number } });
      expect(old.status).toBe('VOID');
      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: cheap!.paymentOrderNumber! } });
      expect(payment.status).toBe('REFUNDED');
      const { subscription } = await subscriptions.current(organizationId);
      expect(subscription?.status).not.toBe(SubscriptionStatus.ACTIVE);
    });

    // B36, for subscriptions: a customer who paid and never came back stayed unpaid.
    // D19: refunding a subscription payment in full voids its invoice and ends the plan now.
    it('ends the plan when its payment is refunded in full, and not when in part', async () => {
      await activeOn('basic');
      const invoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId, status: 'PAID' } });

      await payments.refundNonTicket(invoice.paymentOrderNumber!, 4_000n);
      expect((await subscriptions.current(organizationId)).subscription).toMatchObject({ status: SubscriptionStatus.ACTIVE });

      await payments.refundNonTicket(invoice.paymentOrderNumber!, 6_000n);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('VOID');
      const { subscription } = await subscriptions.current(organizationId);
      expect(subscription?.status).toBe(SubscriptionStatus.CANCELLED);
      expect(subscription!.currentPeriodEnd.getTime()).toBeLessThanOrEqual(Date.now());
    });

    // B87: paying an invoice issued before the customer cancelled undid the cancel.
    it('keeps a cancel made after the invoice was issued', async () => {
      await activeOn('basic');
      const { invoice } = await subscribeTo('pro');
      await subscriptions.cancel(organizationId);
      payAtTheBank(invoice!);

      await subscriptions.confirmPayment(organizationId, invoice!.number);

      const { subscription } = await subscriptions.current(organizationId);
      expect(subscription).toMatchObject({ plan: { key: 'pro' }, cancelAtPeriodEnd: true });
    });

    it('settles an invoice the bank captured though the customer never came back', async () => {
      const { invoice } = await subscribeTo('basic');
      payAtTheBank(invoice!);

      await payments.reconcile();
      await subscriptions.settleCapturedInvoices();

      expect((await prisma.invoice.findFirstOrThrow({ where: { number: invoice!.number } })).status).toBe('PAID');
      const { subscription } = await subscriptions.current(organizationId);
      expect(subscription).toMatchObject({ status: SubscriptionStatus.ACTIVE, plan: { key: 'basic' } });
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
  describe('manual renewal', () => {
    async function buyPeriod() {
      await plan({ key: 'renewable', priceMinor: 5000n });
      const choice = await subscriptions.subscribe(organizationId, { planKey: 'renewable', provider: PaymentProvider.FAKE });
      fake.simulateSuccess(`fake_${choice.invoice!.paymentOrderNumber}`);
      await subscriptions.confirmPayment(organizationId, choice.invoice!.number);
      return prisma.subscription.findUniqueOrThrow({ where: { organizationId } });
    }
    const quote = (end: Date) => ({ provider: PaymentProvider.FAKE, expectedPeriodEnd: end.toISOString(),
      expectedPriceMinor: '5000', expectedCurrency: 'AMD', expectedInterval: BillingInterval.MONTHLY });
    it('concurrent early renewal reserves one next period without changing current coverage', async () => {
      const current = await buyPeriod();
      const choices = await Promise.all([subscriptions.renew(organizationId, quote(current.currentPeriodEnd)),
        subscriptions.renew(organizationId, quote(current.currentPeriodEnd))]);
      expect(choices[0].invoice.number).toBe(choices[1].invoice.number);
      const invoice = choices[0].invoice;
      fake.simulateSuccess(`fake_${invoice.paymentOrderNumber}`);
      await subscriptions.confirmPayment(organizationId, invoice.number);
      const after = await prisma.subscription.findUniqueOrThrow({ where: { organizationId } });
      expect(after.currentPeriodStart).toEqual(current.currentPeriodStart);
      expect(after.currentPeriodEnd).toEqual(current.currentPeriodEnd);
      const read = await subscriptions.current(organizationId);
      expect(read.subscription?.pendingRenewal?.number).toBe(invoice.number);
      expect(read.subscription?.paidThrough).toEqual((await prisma.invoice.findUniqueOrThrow({ where: { number: invoice.number } })).periodEnd);
      expect((await subscriptions.renew(organizationId, quote(current.currentPeriodEnd))).invoice.number).toBe(invoice.number);
    });

    async function prepayRenewal() {
      const current = await buyPeriod();
      const choice = await subscriptions.renew(organizationId, quote(current.currentPeriodEnd));
      fake.simulateSuccess(`fake_${choice.invoice.paymentOrderNumber}`);
      await subscriptions.confirmPayment(organizationId, choice.invoice.number);
      return { current, invoice: await prisma.invoice.findUniqueOrThrow({ where: { number: choice.invoice.number } }) };
    }
    it('refunding a reserved renewal leaves the current purchased period intact', async () => {
      const { current, invoice } = await prepayRenewal();
      await payments.refundNonTicket(invoice.paymentOrderNumber!, invoice.totalMinor);
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: current.id } });
      expect(after.status).toBe('ACTIVE');
      expect(after.currentPeriodEnd).toEqual(current.currentPeriodEnd);
      expect((await subscriptions.current(organizationId)).subscription?.pendingRenewal).toBeNull();
    });
    it('activates a reserved period once at the boundary and keeps cancellation at the purchased end', async () => {
      const { current, invoice } = await prepayRenewal();
      await subscriptions.cancel(organizationId);
      await subscriptions.applyDueFreeChanges(current.currentPeriodEnd);
      await subscriptions.applyDueFreeChanges(current.currentPeriodEnd);
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: current.id } });
      expect(after.currentPeriodInvoiceId).toBe(invoice.id);
      expect(after.currentPeriodStart).toEqual(invoice.periodStart);
      expect(after.currentPeriodEnd).toEqual(invoice.periodEnd);
      expect(after.cancelAtPeriodEnd).toBe(true);
    });
    it('schedules Free after prepaid coverage and rejects an immediate paid change', async () => {
      const { current, invoice } = await prepayRenewal();
      await plan({ key: 'free-after-renewal', priceMinor: 0n });
      const free = await subscriptions.subscribe(organizationId, { planKey: 'free-after-renewal' });
      expect(free.subscription?.pendingFree?.effectiveAt).toEqual(invoice.periodEnd);
      await expect(subscriptions.subscribe(organizationId, { planKey: 'renewable', provider: PaymentProvider.FAKE })).rejects.toThrow('paid renewal');
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: current.id } })).currentPeriodEnd).toEqual(current.currentPeriodEnd);
    });
    it('voids unpaid renewal on cancel and compensates a later capture', async () => {
      const current = await buyPeriod();
      const choice = await subscriptions.renew(organizationId, quote(current.currentPeriodEnd));
      await subscriptions.cancel(organizationId);
      fake.simulateSuccess(`fake_${choice.invoice.paymentOrderNumber}`);
      await subscriptions.confirmPayment(organizationId, choice.invoice.number);
      expect((await prisma.payment.findUniqueOrThrow({ where: { orderNumber: choice.invoice.paymentOrderNumber! } })).status).toBe('REFUNDED');
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: current.id } })).currentPeriodEnd).toEqual(current.currentPeriodEnd);
    });
    it('refunds the active purchase even when a later future period has been paid', async () => {
      const { current, invoice } = await prepayRenewal();
      const active = await prisma.invoice.findUniqueOrThrow({ where: { id: current.currentPeriodInvoiceId! } });
      await payments.refundNonTicket(active.paymentOrderNumber!, active.totalMinor);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: current.id } })).status).toBe('CANCELLED');
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID');
      await subscriptions.applyDueFreeChanges(invoice.periodStart!);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: current.id } })).currentPeriodInvoiceId).toBe(invoice.id);
    });
    it('keeps reserved coverage while a full refund is unresolved and recovers a completed refund', async () => {
      const { current, invoice } = await prepayRenewal();
      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: invoice.paymentOrderNumber! } });
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED', refundedMinor: payment.amountMinor } });
      const refund = await prisma.refund.create({ data: { paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency } });
      await subscriptions.endRefundedPlan({ orderNumber: payment.orderNumber, status: 'REFUNDED' });
      await subscriptions.applyDueFreeChanges(invoice.periodStart!);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).activatedAt).toBeNull();
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID');
      await prisma.refund.update({ where: { id: refund.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await subscriptions.recoverRefundedInvoices();
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('VOID');
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: current.id } })).currentPeriodEnd).toEqual(current.currentPeriodEnd);
    });

    it('refuses an existing invoice when the displayed renewal quote changes', async () => {
      const current = await buyPeriod();
      await subscriptions.renew(organizationId, quote(current.currentPeriodEnd));
      await prisma.plan.update({ where: { id: current.planId }, data: { priceMinor: 4000n } });
      await expect(subscriptions.renew(organizationId, { ...quote(current.currentPeriodEnd), expectedPriceMinor: '4000' })).rejects.toThrow('quote');
      expect(await prisma.invoice.count({ where: { kind: 'RENEWAL' } })).toBe(1);
    });
    it('cannot charge the same cycle again after cancel/resume while an old payment is unresolved', async () => {
      const current = await buyPeriod();
      const choice = await subscriptions.renew(organizationId, quote(current.currentPeriodEnd));
      await prisma.payment.update({ where: { orderNumber: choice.invoice.paymentOrderNumber! }, data: { status: 'FAILED', outcomeUnknownAt: new Date(), providerRef: null } });
      await subscriptions.cancel(organizationId);
      await subscriptions.resume(organizationId);
      await expect(subscriptions.renew(organizationId, quote(current.currentPeriodEnd))).rejects.toThrow('do not pay again');
      expect(await prisma.invoice.count({ where: { kind: 'RENEWAL' } })).toBe(1);
    });
    it('moves scheduled Free back to the remaining paid end after refunding a future renewal', async () => {
      const { current, invoice } = await prepayRenewal();
      await plan({ key: 'free-after-refund', priceMinor: 0n });
      await subscriptions.subscribe(organizationId, { planKey: 'free-after-refund' });
      await payments.refundNonTicket(invoice.paymentOrderNumber!, invoice.totalMinor);
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: current.id } });
      expect(after.pendingFreeAt).toEqual(current.currentPeriodEnd);
      expect(after.currentPeriodEnd).toEqual(current.currentPeriodEnd);
    });

    it('rotates bounded maintenance past blocked reservations instead of starving later periods', async () => {
      const paid = await plan({ key: 'sweep-progress', priceMinor: 5000n });
      const ids = Array.from({ length: 100 }, (_, index) => `a-blocked-${String(index).padStart(3, '0')}`);
      await prisma.organization.createMany({ data: [...ids, 'z-due'].map((id) => ({ id, name: id })) });
      await prisma.subscription.createMany({ data: [...ids, 'z-due'].map((id) => ({ id, organizationId: id, planId: paid.id,
        status: id === 'z-due' ? 'ACTIVE' : 'EXPIRED', currentPeriodStart: new Date('2026-01-01'), currentPeriodEnd: new Date('2026-02-01') })) });
      await prisma.invoice.createMany({ data: ids.map((id) => ({ id, organizationId: id, subscriptionId: id, planId: paid.id, number: id,
        kind: 'RENEWAL', intervalSnapshot: 'MONTHLY', renewalAnchorEnd: new Date('2026-02-01'), status: 'PAID', subtotalMinor: 5000n, totalMinor: 5000n,
        periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-03-01') })) });
      await subscriptions.applyDueFreeChanges();
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: 'z-due' } })).status).toBe('ACTIVE');
      await subscriptions.applyDueFreeChanges();
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: 'z-due' } })).status).toBe('EXPIRED');
    });

    it.each([true, false])('captures a due reserved entitlement only from its winning payment: %s', async (hasVerifiedWinner) => {
      const { current, invoice } = await prepayRenewal();
      const start = new Date('2026-01-01');
      await prisma.plan.update({ where: { id: current.planId }, data: { invitationLifetimeDays: null } });
      await prisma.subscription.update({ where: { id: current.id }, data: { currentPeriodStart: new Date('2025-12-01'), currentPeriodEnd: start } });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { periodStart: start, periodEnd: new Date('2030-01-01') } });
      await prisma.payment.create({ data: { organizationId, invoiceId: invoice.id, purpose: 'SUBSCRIPTION', provider: 'FAKE',
        amountMinor: invoice.totalMinor, currency: invoice.currency, orderNumber: 'duplicate-capture', idempotencyKey: 'duplicate-capture', status: 'CAPTURED' } });
      if (!hasVerifiedWinner) await prisma.payment.update({ where: { orderNumber: invoice.paymentOrderNumber! }, data: { status: 'REFUNDED', refundedMinor: invoice.totalMinor } });
      const invitation = await prisma.invitation.findFirstOrThrow({ where: { event: { organizationId } } });
      await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'DRAFT', lifetimeSource: null } });
      await prisma.$transaction((tx) => captureInvitationLifetime(tx, invitation.id));
      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).lifetimeSource)
        .toBe(hasVerifiedWinner ? 'PLAN' : 'FREE_DEFAULT');
    });

    it('settles the original monthly quote after catalog price, currency and interval change', async () => {
      const current = await buyPeriod();
      const choice = await subscriptions.renew(organizationId, quote(current.currentPeriodEnd));
      await prisma.plan.update({ where: { id: current.planId }, data: { priceMinor: 9999n, currency: 'USD', interval: 'YEARLY' } });
      fake.simulateSuccess(`fake_${choice.invoice.paymentOrderNumber}`);
      const paid = await subscriptions.confirmPayment(organizationId, choice.invoice.number);
      expect(paid).toMatchObject({ totalMinor: '5000', currency: 'AMD' });
      const purchased = await prisma.invoice.findUniqueOrThrow({ where: { number: choice.invoice.number } });
      const duration = purchased.periodEnd!.getTime() - current.currentPeriodEnd.getTime();
      expect(duration).toBeGreaterThan(27 * 86400000);
      expect(duration).toBeLessThanOrEqual(31 * 86400000);
    });
    it.each(['free', 'per-event', 'cancelled', 'scheduled-free', 'trial', 'inactive'] as const)(
      'refuses new renewal intent for %s without financial writes', async (reason) => {
        const current = await buyPeriod();
        if (reason === 'free') await prisma.plan.update({ where: { id: current.planId }, data: { priceMinor: 0n } });
        if (reason === 'per-event') await prisma.plan.update({ where: { id: current.planId }, data: { interval: 'PER_EVENT' } });
        if (reason === 'inactive') await prisma.plan.update({ where: { id: current.planId }, data: { isActive: false } });
        if (reason === 'cancelled') await subscriptions.cancel(organizationId);
        if (reason === 'trial') await prisma.subscription.update({ where: { id: current.id }, data: { status: 'TRIALING' } });
        if (reason === 'scheduled-free') {
          await plan({ key: 'renewal-free', priceMinor: 0n });
          await subscriptions.subscribe(organizationId, { planKey: 'renewal-free' });
        }
        const before = [await prisma.invoice.count(), await prisma.payment.count()];
        await expect(subscriptions.renew(organizationId, quote(current.currentPeriodEnd))).rejects.toMatchObject({ code: 'RENEWAL_UNAVAILABLE' });
        expect([await prisma.invoice.count(), await prisma.payment.count()]).toEqual(before);
      });

    it.each([
      { interval: BillingInterval.MONTHLY, hasReservation: false, start: '2001-01-31', end: '2001-02-28', ends: ['2001-03-31', '2001-04-30'] },
      { interval: BillingInterval.MONTHLY, hasReservation: true, start: '2001-01-31', end: '2001-02-28', ends: ['2001-03-31', '2001-04-30'] },
      { interval: BillingInterval.YEARLY, hasReservation: false, start: '2024-02-29', end: '2025-02-28', ends: ['2026-02-28', '2027-02-28', '2028-02-29'] },
    ])('preserves a legacy $interval anniversary across renewals (existing reservation: $hasReservation)', async (fixture) => {
      const paid = await plan({ key: 'legacy-calendar', priceMinor: 5000n, interval: fixture.interval });
      let subscription = await prisma.subscription.create({ data: { organizationId, planId: paid.id, status: 'ACTIVE',
        currentPeriodStart: new Date(fixture.start), currentPeriodEnd: new Date(fixture.end), billingAnchorAt: null } });
      // Two or three fixed cycles expose clamping without depending on the test machine's date.
      for (const [index, expectedEnd] of fixture.ends.entries()) {
        const boundary = subscription.currentPeriodEnd;
        const paidAt = new Date(boundary);
        paidAt.setUTCDate(1);
        const orderNumber = `legacy-${fixture.interval}-${index}`;
        const invoice = await prisma.invoice.create({ data: { organizationId, subscriptionId: subscription.id, planId: paid.id,
          number: `AV-${paidAt.getUTCFullYear()}-${String(index + 1).padStart(6, '0')}`, kind: 'RENEWAL', status: 'PAID', paidAt,
          renewalAnchorEnd: boundary, intervalSnapshot: fixture.interval, subtotalMinor: 5000n, totalMinor: 5000n,
          paymentOrderNumber: orderNumber,
          ...(fixture.hasReservation && index === 0 ? { periodStart: boundary, periodEnd: new Date(expectedEnd) } : {}) } });
        await prisma.payment.create({ data: { organizationId, invoiceId: invoice.id, purpose: 'SUBSCRIPTION', provider: 'FAKE',
          amountMinor: 5000n, currency: 'AMD', orderNumber, idempotencyKey: orderNumber, status: 'CAPTURED' } });
        await prisma.$transaction(async (tx) => {
          await lockBillingOrganization(tx, organizationId);
          if (!fixture.hasReservation || index > 0) await settleRenewal(tx, invoice, paidAt);
          await applyDueRenewal(tx, organizationId, boundary);
        });
        subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
        expect(subscription.currentPeriodEnd).toEqual(new Date(expectedEnd));
      }
    });
    it('rejects a changed quote before issuing a charge', async () => {
      const current = await buyPeriod();
      const count = await prisma.invoice.count();
      await expect(subscriptions.renew(organizationId, { ...quote(current.currentPeriodEnd), expectedPriceMinor: '1' }))
        .rejects.toThrow('quote');
      expect(await prisma.invoice.count()).toBe(count);
    });
    it('late renewal buys a full period and a stale-boundary replay cannot buy another', async () => {
      const current = await buyPeriod();
      const end = new Date('2026-01-31T00:00:00Z');
      await prisma.subscription.update({ where: { id: current.id }, data: { currentPeriodStart: new Date('2025-12-31T00:00:00Z'), currentPeriodEnd: end, status: 'EXPIRED' } });
      const choice = await subscriptions.renew(organizationId, quote(end));
      fake.simulateSuccess(`fake_${choice.invoice.paymentOrderNumber}`);
      const before = Date.now();
      await subscriptions.confirmPayment(organizationId, choice.invoice.number);
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: current.id } });
      expect(after.currentPeriodStart.getTime()).toBeGreaterThanOrEqual(before);
      expect(after.currentPeriodEnd.getTime()).toBeGreaterThan(after.currentPeriodStart.getTime() + 27 * 86400000);
      expect((await subscriptions.renew(organizationId, quote(end))).invoice.number).toBe(choice.invoice.number);
      expect(await prisma.invoice.count({ where: { kind: 'RENEWAL' } })).toBe(1);
    });
  });

});
