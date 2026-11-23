import { PaymentEventSource, PaymentPurpose, PaymentProvider, PaymentStatus, PlatformRole, PrismaClient, VerificationPurpose } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { PaymentGatewayRegistry } from '../../src/modules/payments/payment-gateway.registry';
import { FakeGateway } from '../../src/modules/payments/providers/fake.gateway';
import { recoverPayment } from '../../src/modules/payments/payment-recovery';
import { SubscriptionsService } from '../../src/modules/billing/subscriptions.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Payment attempts retain their purchase through uncertain bank outcomes', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let fake: FakeGateway;
  let organizationId: string;
  const dto = (key: string, purpose: PaymentPurpose = PaymentPurpose.DEPOSIT) => ({ organizationId, purpose,
    provider: PaymentProvider.FAKE, amountMinor: '25000', currency: 'AMD', returnUrl: 'https://aveline.test/return', idempotencyKey: key });
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(async () => {
    await resetTestDatabase();
    const event = await seedEvent(prisma);
    organizationId = (await prisma.event.findUniqueOrThrow({ where: { id: event.eventId } })).organizationId;
    fake = new FakeGateway();
    payments = new PaymentsService(prisma as PrismaService, new PaymentGatewayRegistry([fake]));
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(disconnectTestDatabase);

  const invoice = async () => {
    const plan = await prisma.plan.create({ data: { key: 'safety-plan', name: 'Safety plan', tier: 'MANAGED', priceMinor: 25000n, interval: 'MONTHLY' } });
    return prisma.invoice.create({ data: { organizationId, planId: plan.id, number: 'SAFETY-1', status: 'ISSUED', subtotalMinor: 25000n, totalMinor: 25000n } });
  };

  const administrator = async () => {
    const actor = await prisma.user.create({ data: { email: 'admin@safety.test', name: 'Admin', platformRole: 'ADMIN' } });
    await prisma.verificationToken.create({ data: { userId: actor.id, purpose: VerificationPurpose.EMAIL_VERIFICATION,
      tokenHash: `verified-${actor.id}`, usedAt: new Date('2026-11-01'), expiresAt: new Date('2026-11-01') } });
    return actor;
  };

  it('quarantines a registration whose bank reference already identifies another attempt', async () => {
    const first = await payments.start(dto('reference-owner'));
    const original = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: first.orderNumber } });
    jest.spyOn(fake, 'registerOrder').mockResolvedValue({ providerRef: original.providerRef!, redirectUrl: 'https://bank.test/pay' });
    await expect(payments.start(dto('reference-reused'))).rejects.toThrow('outcome is unknown');
    const duplicate = await prisma.payment.findUniqueOrThrow({ where: { idempotencyKey: 'reference-reused' } });
    expect(duplicate.status).toBe(PaymentStatus.CREATED);
    expect(duplicate.providerRef).toBeNull();
    expect(duplicate.outcomeUnknownAt).not.toBeNull();
  });

  it('retains a pending bank order after the local deadline and later captures it', async () => {
    const started = await payments.start(dto('overdue-bank-order'));
    await prisma.payment.update({ where: { orderNumber: started.orderNumber }, data: { expiresAt: new Date('2000-01-01') } });
    await payments.reconcile();
    expect((await payments.findByOrderNumber(started.orderNumber)).status).toBe(PaymentStatus.PENDING);
    const row = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: started.orderNumber } });
    fake.simulateSuccess(row.providerRef!);
    await payments.reconcile();
    expect((await payments.findByOrderNumber(started.orderNumber)).status).toBe(PaymentStatus.CAPTURED);
  });

  it('links an invoice attempt before the provider can accept its registration', async () => {
    const issued = await invoice();
    const register = fake.registerOrder.bind(fake);
    jest.spyOn(fake, 'registerOrder').mockImplementation(async (params) => {
      const claim = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: params.orderNumber } });
      expect(claim.invoiceId).toBe(issued.id);
      expect(claim.registrationStartedAt).not.toBeNull();
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } })).paymentOrderNumber).toBe(params.orderNumber);
      return register(params);
    });
    await payments.start(dto(`invoice-${issued.id}`, PaymentPurpose.SUBSCRIPTION), { invoiceId: issued.id });
  });

  it('keeps the original invoice claim after the bank accepted but its response was lost', async () => {
    const issued = await invoice();
    const register = fake.registerOrder.bind(fake);
    const registration = jest.spyOn(fake, 'registerOrder').mockImplementation(async (params) => {
      await register(params);
      throw new Error('synthetic response loss');
    });
    const request = dto(`invoice-${issued.id}`, PaymentPurpose.SUBSCRIPTION);
    await expect(payments.start(request, { invoiceId: issued.id })).rejects.toThrow('outcome is unknown');
    const claim = await prisma.payment.findFirstOrThrow({ where: { invoiceId: issued.id } });
    expect(claim.status).toBe(PaymentStatus.CREATED);
    expect(claim.outcomeUnknownAt).not.toBeNull();
    const repeated = await payments.start(request, { invoiceId: issued.id });
    expect(repeated.orderNumber).toBe(claim.orderNumber);
    expect(registration).toHaveBeenCalledTimes(1);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('recovers an expired attempt through an append-only bank observation', async () => {
    const started = await payments.start(dto('legacy-local-expiry'));
    const row = await prisma.payment.update({ where: { orderNumber: started.orderNumber }, data: { status: PaymentStatus.EXPIRED, outcomeUnknownAt: new Date() } });
    fake.simulateSuccess(row.providerRef!);
    await payments.confirm(started.orderNumber, PaymentEventSource.RECONCILIATION);
    expect(await prisma.paymentEvent.count({ where: { paymentId: row.id, fromStatus: PaymentStatus.EXPIRED, toStatus: PaymentStatus.CAPTURED } })).toBe(1);
  });

  it('fulfills one invoice once and refunds another captured attempt without ending the winning plan', async () => {
    const issued = await invoice();
    const request = dto(`invoice-${issued.id}`, PaymentPurpose.SUBSCRIPTION);
    const first = await payments.start(request, { invoiceId: issued.id });
    const firstRow = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: first.orderNumber } });
    fake.simulate(firstRow.providerRef!, { kind: 'failed', reason: 'declined' });
    await payments.confirm(first.orderNumber, PaymentEventSource.API);
    const second = await payments.start(request, { invoiceId: issued.id });
    const secondRow = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: second.orderNumber } });
    await prisma.payment.update({ where: { id: firstRow.id }, data: { outcomeUnknownAt: new Date() } });
    fake.simulateSuccess(firstRow.providerRef!);
    fake.simulateSuccess(secondRow.providerRef!);
    await payments.confirm(first.orderNumber, PaymentEventSource.RECONCILIATION);
    await payments.confirm(second.orderNumber, PaymentEventSource.RECONCILIATION);
    const billing = new SubscriptionsService(prisma as PrismaService, payments);
    billing.onModuleInit();
    await billing.settleCapturedInvoices();
    const winner = await prisma.payment.findFirstOrThrow({ where: { invoiceId: issued.id, status: PaymentStatus.CAPTURED } });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } })).paymentOrderNumber).toBe(winner.orderNumber);
    expect(await prisma.subscription.count({ where: { organizationId, status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.payment.count({ where: { invoiceId: issued.id, status: PaymentStatus.REFUNDED } })).toBe(1);
    await billing.settleCapturedInvoices();
    expect(await prisma.refund.count()).toBe(1);
  });

  it.each([PaymentStatus.PENDING, PaymentStatus.FAILED])('reuses an earlier capture before a newer %s attempt can collect more money', async (status) => {
    const issued = await invoice();
    const request = dto(`invoice-${issued.id}`, PaymentPurpose.SUBSCRIPTION);
    const first = await payments.start(request, { invoiceId: issued.id });
    const firstRow = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: first.orderNumber } });
    fake.simulate(firstRow.providerRef!, { kind: 'failed', reason: 'declined' });
    await payments.confirm(first.orderNumber, PaymentEventSource.API);
    const second = await payments.start(request, { invoiceId: issued.id });
    const secondRow = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: second.orderNumber } });
    if (status === PaymentStatus.FAILED) {
      fake.simulate(secondRow.providerRef!, { kind: 'failed', reason: 'declined' });
      await payments.confirm(second.orderNumber, PaymentEventSource.API);
    }
    await prisma.payment.update({ where: { id: firstRow.id }, data: { outcomeUnknownAt: new Date() } });
    fake.simulateSuccess(firstRow.providerRef!);
    await payments.confirm(first.orderNumber, PaymentEventSource.RECONCILIATION);
    const register = jest.spyOn(fake, 'registerOrder');
    const repeated = await payments.start(request, { invoiceId: issued.id });
    expect(repeated).toMatchObject({ orderNumber: first.orderNumber, status: PaymentStatus.CAPTURED });
    expect(register).not.toHaveBeenCalled();
    expect(await prisma.payment.count({ where: { invoiceId: issued.id } })).toBe(2);
  });

  it('requires a verified active administrator and records recovery evidence without declaring capture', async () => {
    const started = await payments.start(dto('recovery-reference'));
    await prisma.payment.update({ where: { orderNumber: started.orderNumber }, data: { providerRef: null, status: PaymentStatus.CREATED, outcomeUnknownAt: new Date() } });
    const actor = await prisma.user.create({ data: { email: 'admin@safety.test', name: 'Admin', platformRole: 'ADMIN' } });
    const request = { actorUserId: actor.id, orderNumber: started.orderNumber, action: 'attach-reference' as const,
      providerRef: `fake_${started.orderNumber}`, reason: 'Bank operator confirmed original order', evidenceRef: 'case-123' };
    await expect(recoverPayment(prisma as PrismaService, request)).rejects.toThrow();
    await prisma.verificationToken.create({ data: { userId: actor.id, purpose: VerificationPurpose.EMAIL_VERIFICATION,
      tokenHash: `verified-${actor.id}`, usedAt: new Date('2026-11-01'), expiresAt: new Date('2026-11-01') } });
    await recoverPayment(prisma as PrismaService, request);
    const recovered = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: started.orderNumber } });
    expect(recovered.status).toBe(PaymentStatus.PENDING);
    expect(await prisma.paymentEvent.count({ where: { paymentId: recovered.id, source: 'MANUAL' } })).toBe(1);
    expect(recovered.outcomeUnknownAt).not.toBeNull();
  });

  it('permits a replacement invoice attempt only after audited no-registration evidence', async () => {
    const issued = await invoice();
    const registration = jest.spyOn(fake, 'registerOrder').mockRejectedValueOnce(new Error('synthetic timeout'));
    const request = dto(`invoice-${issued.id}`, PaymentPurpose.SUBSCRIPTION);
    await expect(payments.start(request, { invoiceId: issued.id })).rejects.toThrow('outcome is unknown');
    const original = await prisma.payment.findFirstOrThrow({ where: { invoiceId: issued.id } });
    const actor = await administrator();
    await recoverPayment(prisma as PrismaService, { actorUserId: actor.id, orderNumber: original.orderNumber,
      action: 'no-registration', reason: 'Bank checked its original order ledger', evidenceRef: 'case-no-order' });
    const second = await payments.start(request, { invoiceId: issued.id });
    expect(second.status).toBe(PaymentStatus.PENDING);
    expect(second.orderNumber).not.toBe(original.orderNumber);
    expect(registration).toHaveBeenCalledTimes(2);
    expect(await prisma.paymentEvent.count({ where: { paymentId: original.id, source: 'MANUAL', toStatus: 'FAILED' } })).toBe(1);
  });

  it.each([
    { platformRole: PlatformRole.SUPPORT, isActive: true },
    { platformRole: PlatformRole.NONE, isActive: true },
    { platformRole: PlatformRole.ADMIN, isActive: false },
  ])('refuses recovery by a verified $platformRole account with isActive=$isActive', async (standing) => {
    const started = await payments.start(dto('restricted-recovery'));
    const original = await prisma.payment.update({ where: { orderNumber: started.orderNumber },
      data: { status: PaymentStatus.CREATED, providerRef: null, outcomeUnknownAt: new Date() } });
    const actor = await administrator();
    await prisma.user.update({ where: { id: actor.id }, data: standing });
    await expect(recoverPayment(prisma as PrismaService, { actorUserId: actor.id, orderNumber: original.orderNumber,
      action: 'attach-reference', providerRef: `fake_${original.orderNumber}`, reason: 'Bank checked registration', evidenceRef: 'case-access' }))
      .rejects.toMatchObject({ status: 403 });
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(await prisma.paymentEvent.count({ where: { paymentId: original.id, source: 'MANUAL' } })).toBe(0);
  });

  it.each([
    { status: PaymentStatus.CREATED, providerRef: 'bank-owned-reference' },
    { status: PaymentStatus.CAPTURED, providerRef: null },
  ])('refuses no-registration evidence for a $status attempt with providerRef=$providerRef', async (outcome) => {
    const started = await payments.start(dto('bank-owned-recovery'));
    const original = await prisma.payment.update({ where: { orderNumber: started.orderNumber },
      data: { ...outcome, outcomeUnknownAt: new Date() } });
    const actor = await administrator();
    await expect(recoverPayment(prisma as PrismaService, { actorUserId: actor.id, orderNumber: original.orderNumber,
      action: 'no-registration', reason: 'Attempt must remain protected', evidenceRef: 'case-bank-owned' }))
      .rejects.toMatchObject({ status: 409 });
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(await prisma.paymentEvent.count({ where: { paymentId: original.id, source: 'MANUAL' } })).toBe(0);
  });

  it('keeps an unmatched capture quarantined until exact purchase evidence is supplied', async () => {
    const issued = await invoice();
    const started = await payments.start(dto('legacy-unmatched', PaymentPurpose.SUBSCRIPTION));
    const row = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: started.orderNumber } });
    fake.simulateSuccess(row.providerRef!);
    await payments.confirm(row.orderNumber, PaymentEventSource.RECONCILIATION);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).outcomeUnknownAt).not.toBeNull();
    await prisma.invoice.update({ where: { id: issued.id }, data: { paymentOrderNumber: row.orderNumber } });
    await expect(payments.start(dto('legacy-unmatched', PaymentPurpose.SUBSCRIPTION), { invoiceId: issued.id }))
      .rejects.toThrow('verified purchase association');
    const actor = await administrator();
    const recovery = { actorUserId: actor.id, orderNumber: row.orderNumber, action: 'attach-reference' as const,
      providerRef: row.providerRef!, invoiceId: issued.id, reason: 'Bank ledger matched invoice', evidenceRef: 'case-invoice' };
    await prisma.invoice.update({ where: { id: issued.id }, data: { totalMinor: 1n } });
    await expect(recoverPayment(prisma as PrismaService, recovery)).rejects.toThrow('does not match');
    await prisma.invoice.update({ where: { id: issued.id }, data: { totalMinor: row.amountMinor } });
    await recoverPayment(prisma as PrismaService, recovery);
    const recovered = await prisma.payment.findUniqueOrThrow({ where: { id: row.id } });
    expect(recovered).toMatchObject({ status: PaymentStatus.CAPTURED, invoiceId: issued.id, outcomeUnknownAt: null });
    expect(await prisma.paymentEvent.count({ where: { paymentId: row.id, source: 'MANUAL', fromStatus: 'CAPTURED', toStatus: 'CAPTURED' } })).toBe(1);
  });
});
