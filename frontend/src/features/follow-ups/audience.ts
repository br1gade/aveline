import type { InvitationStatus } from '@/features/events';
import type { Guest, Household } from '@/features/guests';
import type { DeliveryReport, DeliveryStatus, Destination, Reachable } from '@/features/sending';

import type { ThankBasis } from './types';

/**
 * Who each send is expected to reach, before it is pressed. **A temporary stand-in (design PD-96):**
 * neither send has a dry run (FR-84), so this mirrors `reminder.service.ts` from the guest list and
 * the delivery report, and the page calls the result "expected". The server decides, and its answer
 * replaces this. It can be wrong where the report is thinner than the backend's own read: it gives
 * each household's latest attempt and its time, not every attempt's; who would receive a message
 * now, not who was sent the invitation; and reminders that went, not one that failed today. Deleted
 * when FR-84 is answered.
 */

export interface ExpectedHousehold {
  householdId: string;
  household: string;
  /** How it would go, when the report says. */
  destination: Destination | null;
  /** The backend's reason, in English (FR-33), for a household nothing can reach. */
  reason?: string;
}

export interface ChaseAudience {
  due: ExpectedHousehold[];
  /** Invited too recently: three days' wait, one when the event is under a week away. */
  tooRecent: ExpectedHousehold[];
  /** Had a reminder in the last day, by hand or by the schedule. */
  remindedToday: ExpectedHousehold[];
  /** Undecided, and the invitation has not reached them: the fix is to send. */
  notReached: ExpectedHousehold[];
  cannotReach: ExpectedHousehold[];
  /** Households with nobody left to chase. */
  answered: number;
}

export interface ThanksAudience {
  basis: ThankBasis;
  reached: ExpectedHousehold[];
  cannotReach: ExpectedHousehold[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** The backend's failed statuses (`previous-attempts.ts`), and nothing sent at all. */
const NOT_REACHED: ReadonlySet<DeliveryStatus> = new Set([
  'NOT_SENT',
  'FAILED',
  'BOUNCED',
  'SUPPRESSED',
  'CANCELLED',
]);

const isUnanswered = (guest: Guest) => !guest.isErased && guest.answer === 'PENDING';

/**
 * Once the invitation reached a household, the backend chases it only when a guest who was sent it
 * has not answered, so a plus-one's silence does not chase the one who answered. The report names
 * today's recipient, the nearest it gives to that guest; when the name is not on the list, anyone
 * undecided counts. Before it reached them, anyone undecided is reason to send it.
 */
function isChased(household: Household, delivery: Reachable | undefined): boolean {
  const isReached = delivery !== undefined && !NOT_REACHED.has(delivery.status);
  const invited = isReached
    ? household.guests.find((guest) => guest.name === delivery.recipient)
    : undefined;
  return invited ? isUnanswered(invited) : household.guests.some(isUnanswered);
}

interface ChaseClock {
  startsAt: string;
  now: number;
}

function reminderWait({ startsAt, now }: ChaseClock): number {
  return Date.parse(startsAt) - now < WEEK_MS ? DAY_MS : 3 * DAY_MS;
}

type ChaseGroup = keyof Omit<ChaseAudience, 'answered'>;

/** Which group a reached household falls in, checked in the backend's order. */
function reachedGroup(delivery: Reachable, clock: ChaseClock): ChaseGroup {
  if (NOT_REACHED.has(delivery.status)) return 'notReached';
  // A day to the millisecond still counts (the backend's `gte`); a wait exactly over has passed.
  const { lastRemindedAt, sentAt } = delivery;
  if (lastRemindedAt && clock.now - Date.parse(lastRemindedAt) <= DAY_MS) return 'remindedToday';
  // A message still in the queue has no `sentAt`: it has only just been invited.
  if (!sentAt || clock.now - Date.parse(sentAt) < reminderWait(clock)) return 'tooRecent';
  return 'due';
}

function expectedOf(household: Household, report: DeliveryReport): ExpectedHousehold {
  const delivery = report.byHousehold.get(household.id);
  const base = { householdId: household.id, household: household.name };
  if (delivery?.kind === 'unreachable') {
    return { ...base, destination: null, reason: delivery.reason };
  }
  return { ...base, destination: delivery?.destination ?? null };
}

export function expectedChase(
  households: readonly Household[],
  report: DeliveryReport,
  clock: ChaseClock,
): ChaseAudience {
  const audience: ChaseAudience = {
    due: [],
    tooRecent: [],
    remindedToday: [],
    notReached: [],
    cannotReach: [],
    answered: 0,
  };
  for (const household of households) {
    const delivery = report.byHousehold.get(household.id);
    const reached = delivery?.kind === 'reachable' ? delivery : undefined;
    if (!isChased(household, reached)) {
      audience.answered += 1;
    } else if (delivery?.kind === 'unreachable') {
      audience.cannotReach.push(expectedOf(household, report));
    } else {
      const group = reached ? reachedGroup(reached, clock) : 'notReached';
      audience[group].push(expectedOf(household, report));
    }
  }
  return audience;
}

/**
 * A door that recorded one arrival is taken as having recorded them all, so a partial list is never
 * padded out with acceptances; only with no arrival at all does it go to who accepted. An unlinked
 * ticket's admission is no check-in (FR-81), so it counts as neither.
 */
export function expectedThanks(
  households: readonly Household[],
  report: DeliveryReport,
): ThanksAudience {
  const isArrival = (guest: Guest) => guest.isCheckedIn;
  const hasArrivals = households.some((household) => household.guests.some(isArrival));
  const isThanked = hasArrivals ? isArrival : (guest: Guest) => guest.answer === 'ATTENDING';
  const thanked = households
    .filter((household) => household.guests.some(isThanked))
    .map((household) => expectedOf(household, report));
  return {
    basis: hasArrivals ? 'ARRIVED' : 'ACCEPTED',
    reached: thanked.filter((entry) => entry.reason === undefined),
    cannotReach: thanked.filter((entry) => entry.reason !== undefined),
  };
}

interface OfferedInvitation {
  status: InvitationStatus;
  isExpired?: boolean | undefined;
}

export type ChaseOffer = 'open' | 'draft' | 'closed' | 'expired' | 'started';

/** The states the backend refuses; each gets a line instead of a button (design PD-95). */
export function chaseOffer(
  invitation: OfferedInvitation,
  startsAt: string,
  now: number,
): ChaseOffer {
  if (invitation.status === 'DRAFT') return 'draft';
  if (invitation.isExpired === true) return 'expired';
  if (invitation.status !== 'PUBLISHED') return 'closed';
  return Date.parse(startsAt) <= now ? 'started' : 'open';
}

export type ThankOffer = 'open' | 'draft' | 'expired' | 'notYet';

/**
 * The backend refuses only before the event. It would send a draft's or an expired invitation's
 * thanks with a link that opens nothing (FR-86), so the page guards those two itself. Stopped
 * replies are the usual state once an event is over, and stay open.
 */
export function thankOffer(
  invitation: OfferedInvitation,
  startsAt: string,
  now: number,
): ThankOffer {
  if (invitation.status === 'DRAFT') return 'draft';
  if (invitation.isExpired === true) return 'expired';
  return Date.parse(startsAt) > now ? 'notYet' : 'open';
}
