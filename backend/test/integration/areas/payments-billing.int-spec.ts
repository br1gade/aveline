import { Logger } from '@nestjs/common';
import {
  PaymentEventSource,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  PlanTier,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import { SubscriptionsService } from '../../../src/modules/billing/subscriptions.service';
import { PaymentGatewayRegistry } from '../../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../../src/modules/payments/payments.service';
import { FakeGateway } from '../../../src/modules/payments/providers/fake.gateway';
import type { ProviderStatus } from '../../../src/modules/payments/providers/payment-provider';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The payment and billing properties the main suites left open: what a failed
 * registration leaves behind, what the audit trail records, that one bad
 * payment or invoice never stops a sweep, and that pilot mode leaves existing
 * money alone.
 */
describe('payments and billing, the remaining properties (integration)', () => {
  let prisma: PrismaClient;
  let fake: FakeGateway;
  let payments: PaymentsService;
  let subscriptions: SubscriptionsService;
  let organizationId: string;

  beforeAll(() => {
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    // A fresh service per test: refund listeners registered by one test must not leak into the next.
    fake = new FakeGateway();
    payments = new PaymentsService(prisma as unknown as PrismaService, new PaymentGatewayRegistry([fake]));
    subscriptions = new SubscriptionsService(prisma as unknown as PrismaService, payments);
    subscriptions.onModuleInit();
    const seeded = await seedEvent(prisma);
    organizationId = (await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } })).organizationId;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => disconnectTestDatabase());

  let keySequence = 0;
  const startDto = (overrides: Record<string, unknown> = {}) => ({
    organizationId,
    purpose: PaymentPurpose.DEPOSIT,
    provider: PaymentProvider.FAKE,
    amountMinor: '25000',
    currency: 'AMD',
    returnUrl: 'https://aveline.test/return',
    idempotencyKey: `key-${(keySequence += 1)}`,
    ...overrides,
  }) as never;

  /** Starts a payment and has the payer complete the bank form, without telling us. */
  const paidAtTheBank = async (overrides: Record<string, unknown> = {}) => {
    const started = await payments.start(startDto(overrides));
    const row = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: started.orderNumber } });
    fake.simulateSuccess(row.providerRef!);
    return row;
  };

  const captured = async (overrides: Record<string, unknown> = {}) => {
    const row = await paidAtTheBank(overrides);
    await payments.confirm(row.orderNumber, PaymentEventSource.CALLBACK);
    return row;
  };

  const eventsOf = (paymentId: string) =>
    prisma.paymentEvent.findMany({ where: { paymentId }, orderBy: { at: 'asc' } });

  const withPilotMode = async (work: () => Promise<void>) => {
    const previous = process.env.PILOT_MODE;
    process.env.PILOT_MODE = 'true';
    try {
      await work();
    } finally {
      if (previous === undefined) delete process.env.PILOT_MODE;
      else process.env.PILOT_MODE = previous;
    }
  };

  describe('a registration the bank refuses', () => {
    it('rejects, and records the payment FAILED with the reason', async () => {
      jest.spyOn(fake, 'registerOrder').mockRejectedValueOnce(new Error('bank unreachable'));
      const dto = startDto({ idempotencyKey: 'refused-once' });

      await expect(payments.start(dto)).rejects.toThrow('bank unreachable');

      const payment = await prisma.payment.findUniqueOrThrow({ where: { idempotencyKey: 'refused-once' } });
      expect(payment).toMatchObject({ status: PaymentStatus.FAILED, failureReason: 'bank unreachable', redirectUrl: null, providerRef: null });
      const events = await eventsOf(payment.id);
      expect(events.map((event) => [event.fromStatus, event.toStatus, event.source])).toEqual([
        [PaymentStatus.CREATED, PaymentStatus.FAILED, PaymentEventSource.API],
      ]);
    });

    it('rejects a paid subscribe whose registration fails', async () => {
      await plan('managed', 25_000n);
      jest.spyOn(fake, 'registerOrder').mockRejectedValueOnce(new Error('bank unreachable'));

      await expect(
        subscriptions.subscribe(organizationId, { planKey: 'managed', provider: PaymentProvider.FAKE }),
      ).rejects.toThrow('bank unreachable');

      const payment = await prisma.payment.findFirstOrThrow({ where: { organizationId } });
      expect(payment).toMatchObject({ purpose: PaymentPurpose.SUBSCRIPTION, status: PaymentStatus.FAILED });
      expect(await prisma.subscription.count({ where: { organizationId } })).toBe(0);
    });

    it('answers a retried paid subscribe with a payable payment after the bank refused registration', async () => {
      await plan('managed', 25_000n);
      jest.spyOn(fake, 'registerOrder').mockRejectedValueOnce(new Error('bank unreachable'));
      await expect(
        subscriptions.subscribe(organizationId, { planKey: 'managed', provider: PaymentProvider.FAKE }),
      ).rejects.toThrow('bank unreachable');

      const retried = await subscriptions.subscribe(organizationId, { planKey: 'managed', provider: PaymentProvider.FAKE });

      expect(retried.payment).toMatchObject({ status: PaymentStatus.PENDING, redirectUrl: expect.any(String) });
      expect(retried.invoice!.paymentOrderNumber).toBe(retried.payment!.orderNumber);
    });

    it('keeps starting a payable payment for the open invoice however many registrations the bank refuses', async () => {
      await plan('managed', 25_000n);
      const subscribe = () => subscriptions.subscribe(organizationId, { planKey: 'managed', provider: PaymentProvider.FAKE });
      jest.spyOn(fake, 'registerOrder')
        .mockRejectedValueOnce(new Error('bank unreachable'))
        .mockRejectedValueOnce(new Error('bank unreachable'));
      await expect(subscribe()).rejects.toThrow('bank unreachable');
      await expect(subscribe()).rejects.toThrow('bank unreachable');

      const retried = await subscribe();
      const again = await subscribe();

      expect(retried.payment).toMatchObject({ status: PaymentStatus.PENDING, redirectUrl: expect.any(String) });
      expect(again.payment!.orderNumber).toBe(retried.payment!.orderNumber);
      expect(await prisma.invoice.count({ where: { organizationId } })).toBe(1);
      expect(await prisma.payment.count({ where: { organizationId } })).toBe(3);
    });

    it('starts a fresh payment for the open invoice once its payment expired at the bank', async () => {
      await plan('managed', 25_000n);
      const first = await subscriptions.subscribe(organizationId, { planKey: 'managed', provider: PaymentProvider.FAKE });
      await prisma.payment.update({ where: { orderNumber: first.payment!.orderNumber }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await payments.reconcile();

      const retried = await subscriptions.subscribe(organizationId, { planKey: 'managed', provider: PaymentProvider.FAKE });

      expect(retried.invoice!.number).toBe(first.invoice!.number);
      expect(retried.payment).toMatchObject({ status: PaymentStatus.PENDING, redirectUrl: expect.any(String) });
      expect(retried.payment!.orderNumber).not.toBe(first.payment!.orderNumber);
    });

    it('gives concurrent retries after a spent payment one new payment between them', async () => {
      await plan('managed', 25_000n);
      const subscribe = () => subscriptions.subscribe(organizationId, { planKey: 'managed', provider: PaymentProvider.FAKE });
      const first = await subscribe();
      await prisma.payment.update({ where: { orderNumber: first.payment!.orderNumber }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await payments.reconcile();

      const retries = await Promise.all([subscribe(), subscribe(), subscribe()]);

      const orderNumbers = new Set(retries.map((retry) => retry.payment!.orderNumber));
      expect(orderNumbers.size).toBe(1);
      expect(retries[0].payment).toMatchObject({ status: PaymentStatus.PENDING, redirectUrl: expect.any(String) });
      expect(await prisma.payment.count({ where: { organizationId } })).toBe(2);
      const invoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId } });
      expect(invoice.paymentOrderNumber).toBe(retries[0].payment!.orderNumber);
    });
  });

  describe('the audit trail', () => {
    it('stores the bank’s status body verbatim on the capture event', async () => {
      const row = await captured();

      const events = await eventsOf(row.id);

      expect(events[1]).toMatchObject({
        fromStatus: PaymentStatus.PENDING,
        toStatus: PaymentStatus.CAPTURED,
        payload: { simulated: 'captured' },
      });
    });

    it('writes a CAPTURED→PARTIALLY_REFUNDED event with the bank’s refund body', async () => {
      const row = await captured();

      await payments.refund(row.orderNumber, 10_000n);

      const events = await eventsOf(row.id);
      expect(events).toHaveLength(3);
      expect(events[2]).toMatchObject({
        fromStatus: PaymentStatus.CAPTURED,
        toStatus: PaymentStatus.PARTIALLY_REFUNDED,
        source: PaymentEventSource.API,
        payload: { simulated: 'refunded' },
      });
    });

    it('writes a PARTIALLY_REFUNDED→REFUNDED event when the balance is refunded', async () => {
      const row = await captured();
      await payments.refund(row.orderNumber, 10_000n);

      await payments.refund(row.orderNumber, 15_000n);

      const events = await eventsOf(row.id);
      expect(events.map((event) => [event.fromStatus, event.toStatus])).toEqual([
        [PaymentStatus.CREATED, PaymentStatus.PENDING],
        [PaymentStatus.PENDING, PaymentStatus.CAPTURED],
        [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED],
        [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
      ]);
    });

    it('records the transition, marked unserialisable, when the bank’s body cannot be stored', async () => {
      const started = await payments.start(startDto());
      const unserialisable: ProviderStatus = { outcome: { kind: 'captured', amountMinor: 25_000n }, raw: { amount: 25_000n } };
      jest.spyOn(fake, 'getStatus').mockResolvedValueOnce(unserialisable);

      const result = await payments.confirm(started.orderNumber, PaymentEventSource.API);

      expect(result.status).toBe(PaymentStatus.CAPTURED);
      const row = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: started.orderNumber } });
      const events = await eventsOf(row.id);
      expect(events[1]).toMatchObject({ toStatus: PaymentStatus.CAPTURED, payload: { unserialisable: true } });
    });
  });

  describe('two confirmations at once', () => {
    /** Holds the next status call open until released, so another caller can overtake it. */
    const holdNextStatusCall = () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let reached: () => void = () => undefined;
      const isReached = new Promise<void>((resolve) => { reached = resolve; });
      const original = fake.getStatus.bind(fake);
      jest.spyOn(fake, 'getStatus').mockImplementationOnce(async (providerRef) => {
        const answer = await original(providerRef);
        reached();
        await gate;
        return answer;
      });
      return { release, isReached };
    };

    it('records exactly one capture when the second confirmation overtakes the first', async () => {
      const row = await paidAtTheBank();
      const held = holdNextStatusCall();

      const slow = payments.confirm(row.orderNumber, PaymentEventSource.API);
      await held.isReached;
      const fast = await payments.confirm(row.orderNumber, PaymentEventSource.RECONCILIATION);
      held.release();
      await slow.catch(() => undefined);

      expect(fast.status).toBe(PaymentStatus.CAPTURED);
      const captures = await prisma.paymentEvent.count({ where: { paymentId: row.id, toStatus: PaymentStatus.CAPTURED } });
      expect(captures).toBe(1);
    });

    it('answers the recorded capture when overtaken between its bank call and its write', async () => {
      const row = await paidAtTheBank();
      const held = holdNextStatusCall();

      const slow = payments.confirm(row.orderNumber, PaymentEventSource.API);
      await held.isReached;
      await payments.confirm(row.orderNumber, PaymentEventSource.RECONCILIATION);
      held.release();

      await expect(slow).resolves.toMatchObject({ orderNumber: row.orderNumber, status: PaymentStatus.CAPTURED });
    });

    it('still refuses when the bank reports a capture for a payment expired meanwhile', async () => {
      const row = await paidAtTheBank();
      const held = holdNextStatusCall();

      const slow = payments.confirm(row.orderNumber, PaymentEventSource.API);
      await held.isReached;
      // The sweep asked a moment earlier, heard "unpaid", and wrote it off on the clock.
      await prisma.payment.update({ where: { id: row.id }, data: { status: PaymentStatus.EXPIRED } });
      held.release();

      await expect(slow).rejects.toThrow('Cannot move a payment from EXPIRED to CAPTURED');
    });

    /**
     * A second service on the same database whose next transition pauses just
     * after its transaction has read the payment, so another confirmation can
     * commit between that read and its compare-and-set write.
     */
    const pausingAfterTransitionRead = () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let reached: () => void = () => undefined;
      const isReached = new Promise<void>((resolve) => { reached = resolve; });
      let isArmed = true;
      // Only what a transition touches: it reads and updates the payment and writes its event.
      const pausingTx = (tx: Prisma.TransactionClient) => ({
        paymentEvent: tx.paymentEvent,
        payment: {
          update: tx.payment.update.bind(tx.payment),
          findUniqueOrThrow: async (args: Prisma.PaymentFindUniqueOrThrowArgs) => {
            const read = await tx.payment.findUniqueOrThrow(args);
            if (isArmed) {
              isArmed = false;
              reached();
              await gate;
            }
            return read;
          },
        },
      });
      const database = {
        payment: prisma.payment,
        $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          prisma.$transaction((tx) => work(pausingTx(tx) as unknown as Prisma.TransactionClient)),
      };
      const service = new PaymentsService(database as unknown as PrismaService, new PaymentGatewayRegistry([fake]));
      return { service, release, isReached };
    };

    it('answers the recorded capture when another confirmation commits between its read and its write', async () => {
      const row = await paidAtTheBank();
      const paused = pausingAfterTransitionRead();

      const slow = paused.service.confirm(row.orderNumber, PaymentEventSource.API);
      await paused.isReached;
      const fast = await payments.confirm(row.orderNumber, PaymentEventSource.RECONCILIATION);
      paused.release();

      await expect(slow).resolves.toMatchObject({ orderNumber: row.orderNumber, status: PaymentStatus.CAPTURED });
      expect(fast.status).toBe(PaymentStatus.CAPTURED);
      const captures = await prisma.paymentEvent.count({ where: { paymentId: row.id, toStatus: PaymentStatus.CAPTURED } });
      expect(captures).toBe(1);
    });
  });

  describe('a refund listener that fails', () => {
    it('still answers the completed refund, and keeps the refund COMPLETED', async () => {
      const listener = jest.fn().mockRejectedValue(new Error('listener broke'));
      payments.onRefunded(PaymentPurpose.DEPOSIT, listener);
      const row = await captured();

      const result = await payments.refund(row.orderNumber, 25_000n);

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: row.orderNumber, status: PaymentStatus.REFUNDED }));
      expect(result).toMatchObject({ status: PaymentStatus.REFUNDED, refundedMinor: '25000' });
      const refunds = await prisma.refund.findMany({ where: { paymentId: row.id } });
      expect(refunds).toEqual([expect.objectContaining({ status: 'COMPLETED', amountMinor: 25_000n })]);
    });

    it('tells only the listener for the payment’s own purpose', async () => {
      const subscriptionListener = jest.fn().mockResolvedValue(undefined);
      payments.onRefunded(PaymentPurpose.SUBSCRIPTION, subscriptionListener);
      const row = await captured({ purpose: PaymentPurpose.DEPOSIT });

      await payments.refund(row.orderNumber, 100n);

      expect(subscriptionListener).not.toHaveBeenCalled();
    });
  });

  describe('a sweep with one bank call failing', () => {
    it('logs and skips that payment, and still settles the rest', async () => {
      const first = await paidAtTheBank();
      const second = await paidAtTheBank();
      jest.spyOn(fake, 'getStatus').mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(payments.reconcile()).resolves.toEqual({ checked: 2, changed: 1 });

      const statuses = await prisma.payment.findMany({ where: { id: { in: [first.id, second.id] } }, select: { status: true } });
      expect(statuses.map((payment) => payment.status).sort()).toEqual([PaymentStatus.CAPTURED, PaymentStatus.PENDING]);
    });

    it('asks again about the skipped payment on the next sweep', async () => {
      const row = await paidAtTheBank();
      jest.spyOn(fake, 'getStatus').mockRejectedValueOnce(new Error('ECONNRESET'));
      await payments.reconcile();

      await expect(payments.reconcile()).resolves.toEqual({ checked: 1, changed: 1 });

      expect((await prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(PaymentStatus.CAPTURED);
    });
  });

  describe('pilot mode and money that already exists', () => {
    it('still confirms a payment started before the pilot switch', async () => {
      const row = await paidAtTheBank();

      await withPilotMode(async () => {
        const result = await payments.confirm(row.orderNumber, PaymentEventSource.CALLBACK);
        expect(result.status).toBe(PaymentStatus.CAPTURED);
      });
    });

    it('still refunds a captured payment', async () => {
      const row = await captured();

      await withPilotMode(async () => {
        const result = await payments.refund(row.orderNumber, 100n);
        expect(result).toMatchObject({ status: PaymentStatus.PARTIALLY_REFUNDED, refundedMinor: '100' });
      });
    });

    it('still reconciles', async () => {
      const row = await paidAtTheBank();

      await withPilotMode(async () => {
        await expect(payments.reconcile()).resolves.toEqual({ checked: 1, changed: 1 });
      });

      expect((await prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(PaymentStatus.CAPTURED);
    });

    it('refuses a new charge', async () => {
      await withPilotMode(async () => {
        await expect(payments.start(startDto())).rejects.toThrow('Payments are disabled for the free pilot');
      });

      expect(await prisma.payment.count()).toBe(0);
    });
  });

  const plan = (key: string, priceMinor: bigint) =>
    prisma.plan.create({
      data: { key, name: `Plan ${key}`, tier: PlanTier.MANAGED, priceMinor, interval: 'MONTHLY' },
    });

  describe('billing', () => {
    const subscribeTo = (planKey: string, organization = organizationId) =>
      subscriptions.subscribe(organization, { planKey, provider: PaymentProvider.FAKE });
    const payAtTheBank = (invoice: { paymentOrderNumber: string | null }) =>
      fake.simulateSuccess(`fake_${invoice.paymentOrderNumber}`);
    const activeOn = async (planKey: string) => {
      const { invoice } = await subscribeTo(planKey);
      payAtTheBank(invoice!);
      await subscriptions.confirmPayment(organizationId, invoice!.number);
      return invoice!;
    };

    beforeEach(async () => {
      await plan('free', 0n);
      await plan('basic', 10_000n);
      await plan('pro', 50_000n);
    });

    describe('choosing a free plan with a paid invoice open', () => {
      it('voids the open invoice and activates the free plan', async () => {
        const { invoice } = await subscribeTo('basic');

        const result = await subscriptions.subscribe(organizationId, { planKey: 'free' });

        expect(result.subscription).toMatchObject({ status: SubscriptionStatus.ACTIVE, plan: { key: 'free' } });
        expect((await prisma.invoice.findFirstOrThrow({ where: { number: invoice!.number } })).status).toBe('VOID');
      });

      it('refunds the voided invoice if it is paid anyway, and stays on the free plan', async () => {
        const { invoice } = await subscribeTo('basic');
        await subscriptions.subscribe(organizationId, { planKey: 'free' });
        payAtTheBank(invoice!);

        await subscriptions.confirmPayment(organizationId, invoice!.number);

        const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: invoice!.paymentOrderNumber! } });
        expect(payment).toMatchObject({ status: PaymentStatus.REFUNDED, refundedMinor: 10_000n });
        expect((await prisma.invoice.findFirstOrThrow({ where: { number: invoice!.number } })).status).toBe('VOID');
        expect((await subscriptions.current(organizationId)).subscription).toMatchObject({
          status: SubscriptionStatus.ACTIVE,
          plan: { key: 'free' },
        });
      });

      it('refunds it from the sweep when the payer never came back', async () => {
        const { invoice } = await subscribeTo('basic');
        await subscriptions.subscribe(organizationId, { planKey: 'free' });
        payAtTheBank(invoice!);

        await payments.reconcile();
        await subscriptions.settleCapturedInvoices();

        const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: invoice!.paymentOrderNumber! } });
        expect(payment.status).toBe(PaymentStatus.REFUNDED);
        expect((await subscriptions.current(organizationId)).subscription?.plan.key).toBe('free');
      });
    });

    describe('refunding an older invoice in full', () => {
      it('voids that invoice and leaves the newer paid period running', async () => {
        const basic = await activeOn('basic');
        // Paid an hour apart, so "newer" never hangs on two writes sharing a millisecond.
        await prisma.invoice.update({ where: { number: basic.number }, data: { paidAt: new Date(Date.now() - 3_600_000) } });
        await activeOn('pro');

        await payments.refundNonTicket(basic.paymentOrderNumber!, 10_000n);

        expect((await prisma.invoice.findFirstOrThrow({ where: { number: basic.number } })).status).toBe('VOID');
        const { subscription } = await subscriptions.current(organizationId);
        expect(subscription).toMatchObject({ status: SubscriptionStatus.ACTIVE, plan: { key: 'pro' }, cancelledAt: null });
        expect(subscription!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
      });

      it('ends the plan when the refunded invoice is the one the current period was bought with', async () => {
        const basic = await activeOn('basic');
        await prisma.invoice.update({ where: { number: basic.number }, data: { paidAt: new Date(Date.now() - 3_600_000) } });
        const pro = await activeOn('pro');

        await payments.refundNonTicket(pro.paymentOrderNumber!, 50_000n);

        expect((await subscriptions.current(organizationId)).subscription?.status).toBe(SubscriptionStatus.CANCELLED);
      });
    });

    describe('settling invoices the bank captured', () => {
      it('settles the rest when one invoice fails to settle, and the failed one next time', async () => {
        const other = (await prisma.organization.create({ data: { name: 'Second Org', kind: 'HOST' } })).id;
        const { invoice: first } = await subscribeTo('basic');
        const { invoice: second } = await subscribeTo('basic', other);
        payAtTheBank(first!);
        payAtTheBank(second!);
        await payments.reconcile();
        jest.spyOn(subscriptions, 'markInvoicePaid').mockRejectedValueOnce(new Error('db blip'));

        const statusesOf = async () => {
          const invoices = await prisma.invoice.findMany({ where: { number: { in: [first!.number, second!.number] } } });
          return invoices.map((invoice) => invoice.status).sort();
        };

        await expect(subscriptions.settleCapturedInvoices()).resolves.toEqual({ settled: 1 });
        expect(await statusesOf()).toEqual(['ISSUED', 'PAID']);

        await expect(subscriptions.settleCapturedInvoices()).resolves.toEqual({ settled: 1 });
        expect(await statusesOf()).toEqual(['PAID', 'PAID']);
        for (const organization of [organizationId, other]) {
          expect((await subscriptions.current(organization)).subscription).toMatchObject({ status: SubscriptionStatus.ACTIVE, plan: { key: 'basic' } });
        }
      });
    });
  });
});
