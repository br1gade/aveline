import { BillingInterval, InvoiceStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { invoiceLinesDisplay, planDisplay } from './billing-display';
import { freeTerms } from './scheduled-free';

export interface InvoiceRow {
  kind?: 'PURCHASE' | 'RENEWAL';
  periodStart?: Date | null;
  periodEnd?: Date | null;
  renewalAnchorEnd?: Date | null;
  id: string;
  number: string;
  status: InvoiceStatus;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  currency: string;
  lines: Prisma.JsonValue;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  paymentOrderNumber: string | null;
}

export interface SubscriptionWithPlan {
  invoices?: { number: string; periodStart: Date | null; periodEnd: Date | null }[];
  id: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  trialEndsAt: Date | null;
  pendingFreeAt: Date | null;
  pendingFreeTerms: Prisma.JsonValue;
  activeFreeTerms: Prisma.JsonValue;
  plan: {
    isActive?: boolean;
    key: string; name: string; tier: string; priceMinor: bigint; currency: string;
    interval: BillingInterval; features: string[]; maxEventsPerPeriod: number | null;
    maxGuestsPerEvent: number | null; maxLocales: number; invitationLifetimeDays: number | null;
    translations?: Prisma.JsonValue;
  };
}

export function describeSubscription(subscription: SubscriptionWithPlan, locale = 'en') {
  const plan = freeTerms(subscription.activeFreeTerms) ?? subscription.plan;
  const scheduled = freeTerms(subscription.pendingFreeTerms);
  const renewal = describeRenewal(subscription);
  return {
    ...renewal,
    pendingFree: scheduled && subscription.pendingFreeAt ? { planKey: scheduled.key, effectiveAt: subscription.pendingFreeAt } : null,
    status: subscription.status,
    plan: { key: plan.key, name: plan.name, tier: plan.tier, priceMinor: plan.priceMinor.toString(),
      currency: plan.currency, interval: plan.interval, display: planDisplay(plan, locale) },
    entitlements: { maxEventsPerPeriod: plan.maxEventsPerPeriod, maxGuestsPerEvent: plan.maxGuestsPerEvent,
      maxLocales: plan.maxLocales, invitationLifetimeDays: plan.invitationLifetimeDays, features: plan.features },
    currentPeriodStart: subscription.currentPeriodStart, currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, cancelledAt: subscription.cancelledAt, trialEndsAt: subscription.trialEndsAt,
  };
}

export function describeInvoice(invoice: InvoiceRow, locale = 'en') {
  return {
    kind: invoice.kind ?? 'PURCHASE', periodStart: invoice.periodStart ?? null, periodEnd: invoice.periodEnd ?? null, renewalAnchorEnd: invoice.renewalAnchorEnd ?? null,
    number: invoice.number, status: invoice.status,
    subtotalMinor: invoice.subtotalMinor.toString(), taxMinor: invoice.taxMinor.toString(),
    totalMinor: invoice.totalMinor.toString(), currency: invoice.currency,
    lines: invoiceLinesDisplay(invoice.lines, locale),
    issuedAt: invoice.issuedAt, dueAt: invoice.dueAt, paidAt: invoice.paidAt,
    paymentOrderNumber: invoice.paymentOrderNumber,
  };
}

function describeRenewal(subscription: SubscriptionWithPlan) {
  const reserved = subscription.invoices?.[0];
  const pendingRenewal = reserved?.periodStart && reserved.periodEnd
    ? { number: reserved.number, start: reserved.periodStart, end: reserved.periodEnd } : null;
  return { pendingRenewal, paidThrough: pendingRenewal?.end ?? subscription.currentPeriodEnd,
    canRenew: canRenew(subscription) && !pendingRenewal };
}

function canRenew(subscription: SubscriptionWithPlan) {
  return ['ACTIVE', 'EXPIRED'].includes(subscription.status) && !subscription.cancelAtPeriodEnd &&
    !subscription.pendingFreeAt && !subscription.activeFreeTerms && subscription.plan.priceMinor > 0n && subscription.plan.interval !== 'PER_EVENT' && subscription.plan.isActive !== false;
}
