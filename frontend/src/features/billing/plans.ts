import type { Plan, Subscription } from './types';

/** Never through a number: minor units are strings (root CLAUDE.md §3). */
export function isFree(priceMinor: string): boolean {
  return BigInt(priceMinor) === 0n;
}

export type Standing = 'active' | 'ending' | 'lapsed' | 'trial' | 'pastDue' | 'ended' | 'unknown';

const BY_STATUS: Readonly<Record<string, Standing>> = {
  TRIALING: 'trial',
  PAST_DUE: 'pastDue',
  CANCELLED: 'ended',
  EXPIRED: 'ended',
};

/**
 * Where a subscription stands at `now`. Nothing renews or moves one once its period passes
 * (docs/API.md §10), so an `ACTIVE` one past its end is said to have ended (FR-110).
 */
export function standing(subscription: Subscription, now: number): Standing {
  if (subscription.status !== 'ACTIVE') return BY_STATUS[subscription.status] ?? 'unknown';
  if (Date.parse(subscription.currentPeriodEnd) < now) return 'lapsed';
  return subscription.cancelAtPeriodEnd ? 'ending' : 'active';
}

const STILL_HOLDS: ReadonlySet<Standing> = new Set(['active', 'ending', 'trial', 'pastDue']);

function stillHolds(subscription: Subscription | null, now: number): subscription is Subscription {
  return subscription !== null && STILL_HOLDS.has(standing(subscription, now));
}

/** A plan held and running is marked, not offered: choosing it again would start a new period. */
export function offerFor(plan: Plan, current: Subscription | null, now: number) {
  return stillHolds(current, now) && current.plan.key === plan.key ? 'current' : 'choose';
}

export type ChoiceKind = 'paid' | 'paidChange' | 'free' | 'freeOverPaid';

/**
 * What the question before choosing says. A free plan starts at once and ends a paid period with no
 * refund (`subscriptions.service.ts`, `subscribe`; PQ-24); a paid one leaves the plan as it is until
 * it's paid, though it withdraws an invoice open for another plan at once (design PD-128).
 */
export function choiceKind(plan: Plan, current: Subscription | null, now: number): ChoiceKind {
  const isHeld = stillHolds(current, now);
  if (!isFree(plan.priceMinor)) return isHeld ? 'paidChange' : 'paid';
  return isHeld && !isFree(current.plan.priceMinor) ? 'freeOverPaid' : 'free';
}
