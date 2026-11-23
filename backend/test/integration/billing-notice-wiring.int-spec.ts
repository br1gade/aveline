import { PrismaClient } from '@prisma/client';
import { RequestActor } from '../../src/infra/auth/actor';
import { lockCurrentUsers, lockOrganizationStanding } from '../../src/infra/auth/access-locks';
import { SubscriptionsService } from '../../src/modules/billing/subscriptions.service';
import { SubscriptionNotifierService } from '../../src/modules/billing/subscription-notifier.service';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { PaymentGatewayRegistry } from '../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { FakeGateway } from '../../src/modules/payments/providers/fake.gateway';
import { PrismaService } from '../../src/prisma/prisma.service';
import { syncPlatformCopy } from '../../src/seed/message-copy-sync';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('subscription notice wiring (integration)', () => {
  let prisma: PrismaClient;
  let subscriptions: SubscriptionsService;
  let organizationId: string;
  let actor: RequestActor;
  let payments: PaymentsService;

  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(async () => {
    await resetTestDatabase();
    await syncPlatformCopy(prisma, 'fill');
    const user = await prisma.user.create({ data: { name: 'Original payer', email: 'original@example.test',
      verificationTokens: { create: { purpose: 'EMAIL_VERIFICATION', tokenHash: 'verified-payer', usedAt: new Date(), expiresAt: new Date() } } } });
    const organization = await prisma.organization.create({ data: { name: 'Payer organization',
      memberships: { create: { userId: user.id, role: 'OWNER' } } } });
    organizationId = organization.id;
    actor = { userId: user.id, email: user.email, platformRole: 'NONE', organizationId, organizationRole: 'OWNER' };
    const db = prisma as unknown as PrismaService;
    const notifier = new SubscriptionNotifierService(db, new CommunicationsService(db, new Map(), new SuppressionService(db)));
    notifier.onModuleInit();
    payments = new PaymentsService(db, new PaymentGatewayRegistry([new FakeGateway()]));
    subscriptions = new SubscriptionsService(db, payments, notifier);
    subscriptions.onModuleInit();
    await prisma.plan.create({ data: { key: 'paid', name: 'Captured name', tier: 'MANAGED', priceMinor: 25000n, interval: 'MONTHLY',
      translations: { ru: { name: 'Сохранённый тариф' } } } });
  });
  afterAll(() => disconnectTestDatabase());
  afterEach(() => jest.restoreAllMocks());

  const subscribe = (payer = actor, locale = 'ru') => subscriptions.subscribe(
    organizationId, { planKey: 'paid', provider: 'FAKE' }, { actor: payer, locale });

  it('captures the original initiator and translated invoice wording across later retries and plan edits', async () => {
    await subscribe();
    const other = await prisma.user.create({ data: { name: 'Other owner', email: 'other@example.test',
      organizationMemberships: { create: { organizationId, role: 'OWNER' } } } });
    await prisma.plan.update({ where: { key: 'paid' }, data: { translations: { ru: { name: 'Changed later' } } } });
    await subscribe({ ...actor, userId: other.id, email: other.email }, 'en');
    const invoice = await prisma.invoice.findFirstOrThrow();
    expect(invoice).toMatchObject({ requestedByUserId: actor.userId, paymentNoticeLocale: 'ru' });
    expect(invoice.lines).toEqual([expect.objectContaining({ description: 'Captured name (monthly)',
      descriptionTranslations: { ru: 'Сохранённый тариф (ежемесячно)' } })]);
    await subscriptions.markInvoicePaid(invoice.id);
    await subscriptions.markInvoicePaid(invoice.id);
    expect(await prisma.message.findMany({ where: { templateKey: 'subscription.paid' } })).toEqual([
      expect.objectContaining({ toAddress: actor.email, locale: 'ru', body: expect.stringContaining('Сохранённый тариф') }),
    ]);
    expect(await prisma.subscription.count({ where: { organizationId, status: 'ACTIVE' } })).toBe(1);
  });

  it('keeps paid access when enqueue fails and recovers the missing notice through the sweep', async () => {
    await subscribe();
    const invoice = await prisma.invoice.findFirstOrThrow();
    await prisma.messageTemplate.deleteMany({ where: { key: 'subscription.paid' } });
    await subscriptions.markInvoicePaid(invoice.id);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { organizationId } })).toMatchObject({ status: 'ACTIVE' });
    expect(await prisma.message.count()).toBe(0);
    await syncPlatformCopy(prisma, 'fill');
    const result = await subscriptions.sendMissingPaymentNotices();
    expect(result).toEqual({ queued: 1 });
  });

  it('rejects an actor who lost access before invoice creation without consuming an invoice number', async () => {
    await prisma.organizationMembership.deleteMany({ where: { userId: actor.userId } });
    await expect(subscribe()).rejects.toMatchObject({ status: 403 });
    expect(await prisma.invoice.count()).toBe(0);
    expect(await prisma.invoiceCounter.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('keeps an unmatched legacy capture quarantined even when an invoice still points to it', async () => {
    await subscribe();
    const invoice = await prisma.invoice.findFirstOrThrow();
    await prisma.payment.update({ where: { orderNumber: invoice.paymentOrderNumber! },
      data: { status: 'CAPTURED', invoiceId: null, outcomeUnknownAt: new Date() } });
    expect(await subscriptions.settleCapturedInvoices()).toEqual({ settled: 0 });
    await expect(subscriptions.confirmPayment(organizationId, invoice.number)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: 'ISSUED' });
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('does not activate a plan when a full refund wins the gap before invoice settlement', async () => {
    await subscribe();
    const invoice = await prisma.invoice.findFirstOrThrow();
    const orderNumber = invoice.paymentOrderNumber!;
    await prisma.payment.update({ where: { orderNumber }, data: { status: 'CAPTURED' } });
    const settle = subscriptions.markInvoicePaid.bind(subscriptions);
    jest.spyOn(subscriptions, 'markInvoicePaid').mockImplementationOnce(async (...args) => {
      await payments.refundNonTicket(orderNumber, invoice.totalMinor);
      return settle(...args);
    });
    await expect(subscriptions.confirmPayment(organizationId, invoice.number)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.payment.findUniqueOrThrow({ where: { orderNumber } })).toMatchObject({ status: 'REFUNDED' });
    expect(await prisma.message.count()).toBe(0);
  });

  it.each(['callback', 'sweep'] as const)('activates the paid plan after a partial refund through %s settlement', async (route) => {
    await subscribe();
    const invoice = await prisma.invoice.findFirstOrThrow();
    const orderNumber = invoice.paymentOrderNumber!;
    await prisma.payment.update({ where: { orderNumber }, data: { status: 'CAPTURED' } });
    await payments.refundNonTicket(orderNumber, 1000n);
    if (route === 'callback') await subscriptions.confirmPayment(organizationId, invoice.number);
    else await subscriptions.settleCapturedInvoices();
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: 'PAID' });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { organizationId } })).toMatchObject({ status: 'ACTIVE' });
    expect(await prisma.payment.findUniqueOrThrow({ where: { orderNumber } })).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedMinor: 1000n });
  });

  it('allows a permission write holding the organization to finish while subscription creation waits', async () => {
    let billing: Promise<unknown> | undefined;
    await prisma.$transaction(async (tx) => {
      await lockOrganizationStanding(tx, { organizationId, mode: 'update' });
      billing = subscribe().catch((error: unknown) => error);
      await waitForBillingOrganizationLock(prisma);
      await lockCurrentUsers(tx, [actor.userId]);
      await tx.organization.update({ where: { id: organizationId }, data: { name: 'Renamed concurrently' } });
    });
    const selected = await billing;
    expect(selected).not.toBeInstanceOf(Error);
    expect(selected).toMatchObject({ invoice: { status: 'ISSUED' } });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).toMatchObject({ name: 'Renamed concurrently' });
  });
});

async function waitForBillingOrganizationLock(prisma: PrismaClient): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = await prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE 'SELECT id FROM organizations WHERE id = %FOR UPDATE'`;
    if (waiting.length) return;
  }
  throw new Error('Subscription creation did not reach the organization lock');
}
