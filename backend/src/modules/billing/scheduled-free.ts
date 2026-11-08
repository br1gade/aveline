import { Plan, Prisma, SubscriptionStatus } from '@prisma/client';
import { periodAfter } from './billing-period';

export const CLEAR_SCHEDULED_FREE = {
  pendingFreeAt: null, pendingFreePlanId: null, pendingFreeTerms: Prisma.DbNull,
} as const;

type FreeTerms = Pick<Plan, 'key' | 'name' | 'tier' | 'currency' | 'interval' | 'features' |
  'maxEventsPerPeriod' | 'maxGuestsPerEvent' | 'maxLocales' | 'invitationLifetimeDays'> & { priceMinor: '0' };

export function captureFreeTerms(plan: Plan): FreeTerms {
  return {
    key: plan.key, name: plan.name, tier: plan.tier, currency: plan.currency, interval: plan.interval,
    priceMinor: '0', features: plan.features, maxEventsPerPeriod: plan.maxEventsPerPeriod,
    maxGuestsPerEvent: plan.maxGuestsPerEvent, maxLocales: plan.maxLocales,
    invitationLifetimeDays: plan.invitationLifetimeDays,
  };
}

export function freeTerms(terms: Prisma.JsonValue): FreeTerms | null {
  // Both columns are written only by the billing transition.
  return terms as FreeTerms | null;
}

export async function lockBillingOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
}

/** Caller serializes billing changes on the organization before applying a due transition. */
export async function applyScheduledFree(tx: Prisma.TransactionClient, organizationId: string, now: Date) {
  const scheduled = await tx.subscription.findFirst({
    where: { organizationId, pendingFreeAt: { lte: now } },
    select: { id: true, pendingFreeAt: true, pendingFreePlanId: true, pendingFreeTerms: true },
  });
  const terms = freeTerms(scheduled?.pendingFreeTerms ?? null);
  if (!scheduled?.pendingFreeAt || !scheduled.pendingFreePlanId || !terms) return;

  const period = periodAfter(terms.interval, scheduled.pendingFreeAt);
  await tx.subscription.update({
    where: { id: scheduled.id },
    data: {
      ...CLEAR_SCHEDULED_FREE,
      activeFreeTerms: terms,
      planId: scheduled.pendingFreePlanId,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    },
  });
}
