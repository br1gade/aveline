import { InvoiceStatus, PrismaClient } from '@prisma/client';
import { SubscriptionNotifierService } from '../../src/modules/billing/subscription-notifier.service';
import { eraseBillingContext, exportBillingContext } from '../../src/modules/billing/billing-privacy';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { syncPlatformCopy } from '../../src/seed/message-copy-sync';
import { eraseSubject } from '../../src/modules/privacy/erasure';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('subscription payment notices (integration)', () => {
  let prisma: PrismaClient;
  let notifier: SubscriptionNotifierService;
  let communications: CommunicationsService;
  let userId: string;
  let organizationId: string;
  const at = new Date('2026-11-23T10:00:00Z');

  beforeAll(() => {
    prisma = testPrisma();
    const db = prisma as unknown as PrismaService;
    communications = new CommunicationsService(db, new Map(), new SuppressionService(db));
    notifier = new SubscriptionNotifierService(db, communications);
    notifier.onModuleInit();
  });
  beforeEach(async () => {
    await resetTestDatabase();
    notifier = new SubscriptionNotifierService(prisma as unknown as PrismaService, communications);
    notifier.onModuleInit();
    await syncPlatformCopy(prisma, 'fill');
    const user = await prisma.user.create({ data: { name: 'Payer', email: 'payer@example.test',
      verificationTokens: { create: { tokenHash: 'used-verification', purpose: 'EMAIL_VERIFICATION', usedAt: at, expiresAt: at } } } });
    userId = user.id;
    organizationId = (await prisma.organization.create({ data: { name: 'Billing organization' } })).id;
  });
  afterAll(() => disconnectTestDatabase());

  const invoice = (overrides: { id: string; paymentNoticeLocale?: string | null; requestedByUserId?: string | null; status?: InvoiceStatus }) =>
    prisma.invoice.create({ data: { organizationId, number: overrides.id, requestedByUserId: userId,
      paymentNoticeLocale: 'ru', status: 'PAID', paidAt: at, totalMinor: 9007199254740993n,
      subtotalMinor: 9007199254740993n, currency: 'AMD', lines: [{ description: 'Captured plan', descriptionTranslations: { ru: 'Сохранённый тариф', en: 'Captured plan', fr: 'Offre enregistrée' } }], ...overrides } });

  it('queues once under concurrent callbacks using the original initiating account and captured amounts', async () => {
    const paid = await invoice({ id: 'paid' });
    await Promise.all([notifier.sendPaymentConfirmation(paid.id), notifier.sendPaymentConfirmation(paid.id)]);
    const messages = await prisma.message.findMany({ where: { templateKey: 'subscription.paid' } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ toAddress: 'payer@example.test', locale: 'ru', dedupeKey: `subscription-paid:${paid.id}`, organizationId: null });
    expect(messages[0].body).toContain('9007199254740993 AMD');
    expect(messages[0].body).toContain('Сохранённый тариф');
    expect(messages[0].body).not.toContain('paymentOrderNumber');
  });

  it.each([
    { id: 'legacy', requestedByUserId: null },
    { id: 'no-language', paymentNoticeLocale: null },
    { id: 'replaced', status: InvoiceStatus.VOID },
  ])('never guesses a recipient or confirms a replaced invoice: $id', async (entry) => {
    const paid = await invoice(entry);
    expect(await notifier.sendPaymentConfirmation(paid.id)).toBe(false);
    expect(await prisma.message.count()).toBe(0);
  });

  it('writes French-requested notices entirely with the English fallback', async () => {
    const paid = await invoice({ id: 'french', paymentNoticeLocale: 'fr' });
    await notifier.sendPaymentConfirmation(paid.id);
    const message = await prisma.message.findFirstOrThrow();
    expect(message.locale).toBe('en');
    expect(message.body).toContain('Captured plan');
    expect(message.body).not.toContain('Offre enregistrée');
  });

  it.each(['inactive', 'deleted', 'unverified'] as const)('does not send a payment notice to an %s account', async (state) => {
    const paid = await invoice({ id: state });
    if (state === 'unverified') await prisma.verificationToken.deleteMany({ where: { userId } });
    else await prisma.user.update({ where: { id: userId }, data: state === 'inactive' ? { isActive: false } : { deletedAt: at } });
    expect(await notifier.sendPaymentConfirmation(paid.id)).toBe(false);
    expect(await prisma.message.count()).toBe(0);
  });

  it('rechecks the recipient account before dispatch after an email change', async () => {
    const paid = await invoice({ id: 'changed-address' });
    await notifier.sendPaymentConfirmation(paid.id);
    await prisma.user.update({ where: { id: userId }, data: { email: 'changed@example.test' } });
    await communications.dispatchDue();
    expect(await prisma.message.findFirstOrThrow()).toMatchObject({ status: 'CANCELLED' });
  });

  it('recovers a missed enqueue without undoing payment or starving a later invoice', async () => {
    const old = await invoice({ id: 'a-unverified' });
    const other = await prisma.user.create({ data: { name: 'Unverified', email: 'unverified@example.test' } });
    await prisma.invoice.update({ where: { id: old.id }, data: { requestedByUserId: other.id } });
    await invoice({ id: 'b-paid' });
    expect(await notifier.sendMissing(1)).toEqual({ queued: 0 });
    expect(await notifier.sendMissing(1)).toEqual({ queued: 1 });
    expect(await prisma.invoice.count({ where: { status: 'PAID' } })).toBe(2);
  });

  it('keeps the invoice paid when template rendering fails and recovers after the copy is restored', async () => {
    const paid = await invoice({ id: 'missing-template' });
    await prisma.messageTemplate.deleteMany({ where: { key: 'subscription.paid' } });
    expect(await notifier.sendPaymentConfirmation(paid.id)).toBe(false);
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ status: 'PAID' });
    await syncPlatformCopy(prisma, 'fill');
    expect(await notifier.sendMissing()).toEqual({ queued: 1 });
  });

  it('cancels a queued confirmation when the invoice is refunded before dispatch', async () => {
    const paid = await invoice({ id: 'refunded' });
    await notifier.sendPaymentConfirmation(paid.id);
    await prisma.invoice.update({ where: { id: paid.id }, data: { status: 'VOID' } });
    await communications.dispatchDue();
    expect(await prisma.message.findFirstOrThrow()).toMatchObject({ status: 'CANCELLED' });
  });

  it('exports and clears only notification context while retaining the financial record', async () => {
    const paid = await invoice({ id: 'privacy' });
    expect(await prisma.$transaction((tx) => exportBillingContext(tx, 'payer@example.test'))).toEqual([
      expect.objectContaining({ number: paid.number, paymentNoticeLocale: 'ru', totalMinor: '9007199254740993' }),
    ]);
    expect(await prisma.$transaction((tx) => eraseBillingContext(tx, 'payer@example.test'))).toBe(1);
    expect(await notifier.sendPaymentConfirmation(paid.id)).toBe(false);
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ totalMinor: 9007199254740993n, requestedByUserId: null, paymentNoticeLocale: null });
  });

  it('cannot recreate recipient data when notification enqueue races account erasure', async () => {
    const paid = await invoice({ id: 'racing-erasure' });
    await Promise.all([notifier.sendPaymentConfirmation(paid.id), prisma.$transaction((tx) => eraseSubject(tx, 'payer@example.test', at))]);
    expect(await prisma.message.count({ where: { toAddress: 'payer@example.test' } })).toBe(0);
    expect(await notifier.sendPaymentConfirmation(paid.id)).toBe(false);
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ totalMinor: 9007199254740993n, requestedByUserId: null });
  });
});
