import type { Arrangement } from './types';

/** A venue as the event's detail lists it, in the host's order. */
export interface VenueFacts {
  id: string;
  role: string;
}

/** A running-order entry as the event's detail lists it. */
export interface TimelineFacts {
  venueId: string | null;
  isInternal: boolean;
}

/**
 * `venue`: a venue guests see. `hidden`: one they don't, offered only once it has tables, so no seat
 * is out of sight. `unspecified`: the plan that names no venue.
 */
export type PlanKind = 'venue' | 'hidden' | 'unspecified';

export interface Plan {
  arrangement: Arrangement;
  kind: PlanKind;
}

/**
 * The backend's own rule (`GUEST_FACING_VENUES`, `guest-facing-venues.ts`): not a preparation
 * venue, and not one only internal running-order entries point at. **A temporary mirror** under
 * FR-52, which asks the arrangements read to say it; a test pins each case.
 */
export function isGuestFacing(venue: VenueFacts, timeline: readonly TimelineFacts[]): boolean {
  if (venue.role === 'PREPARATION') return false;
  const entries = timeline.filter((entry) => entry.venueId === venue.id);
  return !entries.some((entry) => entry.isInternal) || entries.some((entry) => !entry.isInternal);
}

function kindOf(
  arrangement: Arrangement,
  venues: readonly VenueFacts[],
  timeline: readonly TimelineFacts[],
): PlanKind {
  if (arrangement.venueId === null) return 'unspecified';
  const venue = venues.find((each) => each.id === arrangement.venueId);
  return venue && isGuestFacing(venue, timeline) ? 'venue' : 'hidden';
}

/** Where the host's venue order puts it; an arrangement for a venue no longer listed goes last. */
function positionOf(plan: Plan, venues: readonly VenueFacts[]): number {
  if (plan.kind === 'unspecified') return venues.length + 1;
  const position = venues.findIndex((venue) => venue.id === plan.arrangement.venueId);
  return position === -1 ? venues.length : position;
}

/**
 * The plans the page offers (design PD-67): every venue guests see, in the host's order; one they
 * don't, only with tables; the plan without a venue, with tables or when guests see no venue. The
 * API orders arrangements by their opaque id, so the venues' order is the host's.
 */
export function plansOf(
  arrangements: readonly Arrangement[],
  venues: readonly VenueFacts[],
  timeline: readonly TimelineFacts[],
): Plan[] {
  const all = arrangements.map((arrangement) => ({
    arrangement,
    kind: kindOf(arrangement, venues, timeline),
  }));
  const hasVenuePlan = all.some((plan) => plan.kind === 'venue');
  const shown = all.filter(
    (plan) =>
      plan.kind === 'venue' ||
      plan.arrangement.tableCount > 0 ||
      (plan.kind === 'unspecified' && !hasVenuePlan),
  );
  return shown
    .map((plan, order) => ({ plan, order, position: positionOf(plan, venues) }))
    .sort((a, b) => a.position - b.position || a.order - b.order)
    .map(({ plan }) => plan);
}

/** The plan the address names (`?plan=`), or the first. */
export function chosenPlan(plans: readonly Plan[], chosen: string | null): Plan | undefined {
  return plans.find((plan) => plan.arrangement.id === chosen) ?? plans[0];
}
