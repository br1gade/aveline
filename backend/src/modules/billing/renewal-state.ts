import { DomainErrorCode, DomainHttpException } from '../../common/domain-http.exception';
import { Invoice, Prisma } from '@prisma/client';
import { renewalPeriod } from './renewal-period';

export const SUBSCRIPTION_INCLUDE = { plan: true, invoices: {
  where: { kind: 'RENEWAL', status: 'PAID', activatedAt: null }, take: 1,
  select: { number: true, periodStart: true, periodEnd: true },
} } satisfies Prisma.SubscriptionInclude;

export function renewalConflict(code: DomainErrorCode, message: string): never {
  throw new DomainHttpException(code, message);
}

export async function findReservedRenewal(tx: Prisma.TransactionClient, subscriptionId: string) {
  return tx.invoice.findFirst({ where: { subscriptionId, kind: 'RENEWAL', status: 'PAID', activatedAt: null } });
}

export async function voidUnpaidRenewals(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.invoice.updateMany({ where: { organizationId, kind: 'RENEWAL', status: 'ISSUED' }, data: { status: 'VOID' } });
}

/** Caller holds the organization lock. A paid future period never resets current usage. */
export async function settleRenewal(tx: Prisma.TransactionClient, invoice: Invoice, now: Date) {
  const subscription = await tx.subscription.findUniqueOrThrow({ where: { id: invoice.subscriptionId ?? '' } });
  if (!invoice.renewalAnchorEnd || !invoice.intervalSnapshot || subscription.planId !== invoice.planId ||
    subscription.currentPeriodEnd.getTime() !== invoice.renewalAnchorEnd.getTime() || subscription.cancelAtPeriodEnd || subscription.pendingFreeAt) {
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'VOID' } });
    return;
  }
  const period = renewalPeriod({ interval: invoice.intervalSnapshot, end: invoice.renewalAnchorEnd,
    anchor: subscription.billingAnchorAt ?? subscription.currentPeriodStart }, now);
  const purchased = await tx.invoice.update({ where: { id: invoice.id }, data: { periodStart: period.start, periodEnd: period.end } });
  if (period.start <= now) await activateRenewal(tx, purchased, now);
}

async function activateRenewal(tx: Prisma.TransactionClient, invoice: Invoice, now: Date) {
  if (!invoice.periodStart || !invoice.periodEnd || !invoice.subscriptionId || !invoice.planId || !invoice.renewalAnchorEnd) return;
  const subscription = await tx.subscription.findUniqueOrThrow({ where: { id: invoice.subscriptionId },
    select: { billingAnchorAt: true, currentPeriodStart: true } });
  // Legacy rows and already-paid reservations need the anniversary before this start advances.
  const anchor = invoice.periodStart > invoice.renewalAnchorEnd ? invoice.periodStart
    : subscription.billingAnchorAt ?? subscription.currentPeriodStart;
  await tx.invoice.update({ where: { id: invoice.id }, data: { activatedAt: now } });
  await tx.subscription.update({ where: { id: invoice.subscriptionId }, data: {
    status: invoice.periodEnd > now ? 'ACTIVE' : 'EXPIRED', planId: invoice.planId,
    currentPeriodStart: invoice.periodStart, currentPeriodEnd: invoice.periodEnd, currentPeriodInvoiceId: invoice.id,
    billingAnchorAt: anchor,
  } });
}

/** Refund claims can be unresolved. Only a verified, non-fully-claimed capture activates. */
export async function applyDueRenewal(tx: Prisma.TransactionClient, organizationId: string, now: Date) {
  const invoice = await tx.invoice.findFirst({ where: { organizationId, kind: 'RENEWAL', status: 'PAID', activatedAt: null, periodStart: { lte: now } } });
  if (!invoice) return;
  await tx.$queryRaw`SELECT id FROM payments WHERE "orderNumber" = ${invoice.paymentOrderNumber} FOR UPDATE`;
  if (!await findVerifiedRenewalCapture(tx, invoice)) return;
  await activateRenewal(tx, invoice, now);
}

export async function findVerifiedRenewalCapture(tx: Prisma.TransactionClient, invoice: Invoice) {
  const payment = await tx.payment.findFirst({ where: { orderNumber: invoice.paymentOrderNumber ?? '', invoiceId: invoice.id,
    organizationId: invoice.organizationId, purpose: 'SUBSCRIPTION', amountMinor: invoice.totalMinor, currency: invoice.currency,
    outcomeUnknownAt: null, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } } });
  return payment && payment.refundedMinor < payment.amountMinor ? payment : null;
}
