import { ConflictException } from '@nestjs/common';
import { PaymentEventSource, PaymentProvider, PaymentPurpose, PaymentStatus, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PaymentGatewayRegistry } from '../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { FakeGateway } from '../../src/modules/payments/providers/fake.gateway';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Payment correctness against a real database. The properties under test are
 * the ones that cost money when wrong: never charging twice, never moving
 * state backwards, and never losing a payment the bank actually took.
 */
describe('PaymentsService (integration)', () => {
  let prisma: PrismaClient;
  let service: PaymentsService;
  let fake: FakeGateway;
  let organizationId: string;

  const startDto = (overrides: Partial<Record<string, unknown>> = {}) => ({
    organizationId,
    purpose: PaymentPurpose.DEPOSIT,
    provider: PaymentProvider.FAKE,
    amountMinor: '25000',
    currency: 'AMD',
    returnUrl: 'https://aveline.test/return',
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  }) as never;

  beforeAll(() => {
    prisma = testPrisma();
    fake = new FakeGateway();
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      new PaymentGatewayRegistry([fake]),
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    const seeded = await seedEvent(prisma);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
    organizationId = event.organizationId;
  });

  afterAll(() => disconnectTestDatabase());

  describe('idempotency', () => {
    it('returns the original payment when the same key is reused', async () => {
      const dto = startDto();

      const first = await service.start(dto);
      const second = await service.start(dto);

      expect(second.orderNumber).toBe(first.orderNumber);
      expect(await prisma.payment.count()).toBe(1);
    });

    it('registers separate orders for different keys', async () => {
      await service.start(startDto());
      await service.start(startDto());

      expect(await prisma.payment.count()).toBe(2);
    });

    // The real-world shape of a double-tapped pay button.
    it('creates exactly one payment under concurrent identical requests', async () => {
      const dto = startDto();

      const results = await Promise.allSettled([
        service.start(dto),
        service.start(dto),
        service.start(dto),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThan(0);
      expect(await prisma.payment.count()).toBe(1);
    });
  });

  describe('confirmation', () => {
    it('only captures when the bank says the money moved', async () => {
      const started = await service.start(startDto());

      // Payer has not paid yet: confirming must not capture.
      const stillPending = await service.confirm(started.orderNumber, PaymentEventSource.API);
      expect(stillPending.status).toBe(PaymentStatus.PENDING);

      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: started.orderNumber },
      });
      fake.simulateSuccess(payment.providerRef!);

      const captured = await service.confirm(started.orderNumber, PaymentEventSource.CALLBACK);
      expect(captured.status).toBe(PaymentStatus.CAPTURED);
    });

    it('is safe to confirm repeatedly', async () => {
      const started = await service.start(startDto());
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: started.orderNumber },
      });
      fake.simulateSuccess(payment.providerRef!);

      await service.confirm(started.orderNumber, PaymentEventSource.CALLBACK);
      await service.confirm(started.orderNumber, PaymentEventSource.CALLBACK);
      await service.confirm(started.orderNumber, PaymentEventSource.CALLBACK);

      const after = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: started.orderNumber },
      });
      expect(after.status).toBe(PaymentStatus.CAPTURED);
      // One CREATED→PENDING and one PENDING→CAPTURED. No duplicate captures.
      expect(await prisma.paymentEvent.count({ where: { paymentId: after.id } })).toBe(2);
    });

    it('records a failure with the bank’s reason', async () => {
      const started = await service.start(startDto());
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: started.orderNumber },
      });
      fake.simulate(payment.providerRef!, { kind: 'failed', reason: 'Insufficient funds' });

      const result = await service.confirm(started.orderNumber, PaymentEventSource.CALLBACK);

      expect(result.status).toBe(PaymentStatus.FAILED);
      expect(result.failureReason).toBe('Insufficient funds');
    });
  });

  describe('audit trail', () => {
    it('writes one event per transition, with the provider payload', async () => {
      const started = await service.start(startDto());
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: started.orderNumber },
      });
      fake.simulateSuccess(payment.providerRef!);
      await service.confirm(started.orderNumber, PaymentEventSource.CALLBACK);

      const events = await prisma.paymentEvent.findMany({
        where: { paymentId: payment.id },
        orderBy: { at: 'asc' },
      });

      expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
        [PaymentStatus.CREATED, PaymentStatus.PENDING],
        [PaymentStatus.PENDING, PaymentStatus.CAPTURED],
      ]);
      expect(events[1].source).toBe(PaymentEventSource.CALLBACK);
    });
  });

  describe('refunds', () => {
    const capture = async () => {
      const started = await service.start(startDto());
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: started.orderNumber },
      });
      fake.simulateSuccess(payment.providerRef!);
      await service.confirm(started.orderNumber, PaymentEventSource.CALLBACK);
      return started.orderNumber;
    };

    it('marks a part refund as partially refunded and tracks the running total', async () => {
      const orderNumber = await capture();

      const result = await service.refund(orderNumber, 10000n);

      expect(result.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(result.refundedMinor).toBe('10000');
    });

    it('marks the balance of a part refund as fully refunded', async () => {
      const orderNumber = await capture();

      await service.refund(orderNumber, 10000n);
      const result = await service.refund(orderNumber, 15000n);

      expect(result.status).toBe(PaymentStatus.REFUNDED);
      expect(result.refundedMinor).toBe('25000');
    });

    // B41: each refund computed the status from its own stale read.
    it('marks a payment fully refunded when two part refunds complete it at once', async () => {
      const orderNumber = await capture();

      await Promise.all([service.refund(orderNumber, 10000n), service.refund(orderNumber, 15000n)]);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber } });
      expect(payment).toMatchObject({ status: PaymentStatus.REFUNDED, refundedMinor: 25000n });
    });

    it('refuses to refund more than was captured', async () => {
      const orderNumber = await capture();

      await expect(service.refund(orderNumber, 25001n)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to refund a payment that was never captured', async () => {
      const started = await service.start(startDto());

      await expect(service.refund(started.orderNumber, 100n)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('reconciliation', () => {
    it('finds a payment the bank took but whose callback never arrived', async () => {
      const started = await service.start(startDto());
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: started.orderNumber },
      });
      // The bank captured it; we were never told.
      fake.simulateSuccess(payment.providerRef!);

      const result = await service.reconcile();

      expect(result.changed).toBe(1);
      const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(after.status).toBe(PaymentStatus.CAPTURED);
    });

    it('expires an order that was registered and never paid', async () => {
      const started = await service.start(startDto());
      await prisma.payment.update({
        where: { orderNumber: started.orderNumber },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await service.reconcile();

      const after = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: started.orderNumber },
      });
      expect(after.status).toBe(PaymentStatus.EXPIRED);
    });

    // B38: it marked the payment EXPIRED before asking the bank, and EXPIRED
    // is final — a payment the bank had captured was written off.
    it('asks the bank before expiring, and keeps a payment it captured', async () => {
      const started = await service.start(startDto());
      const payment = await prisma.payment.update({
        where: { orderNumber: started.orderNumber },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      fake.simulateSuccess(payment.providerRef!);

      await service.reconcile();

      const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(after.status).toBe(PaymentStatus.CAPTURED);
    });

    it('leaves settled payments alone', async () => {
      const started = await service.start(startDto());
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderNumber: started.orderNumber },
      });
      fake.simulateSuccess(payment.providerRef!);
      await service.confirm(started.orderNumber, PaymentEventSource.CALLBACK);

      await expect(service.reconcile()).resolves.toEqual({ checked: 0, changed: 0 });
    });
  });
});
