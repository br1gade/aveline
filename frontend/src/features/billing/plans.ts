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

/**
 * A plan held and running is marked, not offered: choosing it again would start a new period. A
 * free plan already scheduled for the period's end is marked too (FR-135).
 */
export function offerFor(plan: Plan, current: Subscription | null, now: number) {
  if (!stillHolds(current, now)) return 'choose';
  if (current.plan.key === plan.key) return 'current';
  return current.pendingFree?.planKey === plan.key ? 'pending' : 'choose';
}

/**
 * An active paid period that ends on a date, which a change to Free waits for, as the backend
 * judges it (`subscriptions.service.ts`, FR-135).
 */
function hasPaidPeriod({ status, plan }: Subscription): boolean {
  return status === 'ACTIVE' && !isFree(plan.priceMinor) && plan.interval !== 'PER_EVENT';
}

export type ChoiceKind = 'paid' | 'paidChange' | 'free' | 'freeOverPaid';

/**
 * What the question before choosing says. A free plan over a paid period waits for its end, which
 * can still be withdrawn (FR-135, C-49); otherwise it starts at once. A paid one leaves the plan as
 * it is until it's paid, though it withdraws an invoice open for another plan at once (PD-128).
 */
export function choiceKind(plan: Plan, current: Subscription | null, now: number): ChoiceKind {
  const isHeld = stillHolds(current, now);
  if (!isFree(plan.priceMinor)) return isHeld ? 'paidChange' : 'paid';
  return isHeld && hasPaidPeriod(current) ? 'freeOverPaid' : 'free';
}
