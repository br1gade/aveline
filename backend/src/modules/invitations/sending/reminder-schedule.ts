/**
 * When a reminder is due.
 *
 * Reminders replace the host phoning round the people who have not answered,
 * so the schedule has to behave like a considerate person would: a nudge well
 * ahead, one as the date approaches, one just before — and never two at once.
 *
 * The subtlety is what happens when an invitation goes out late. An event
 * three days away has already passed the three-weeks-out and one-week-out
 * marks, and firing every passed milestone at once would send a guest three
 * emails in one minute. So each milestone owns a *window*, and exactly one
 * window contains any given moment.
 *
 *   ├─ 21 days ─────┼─ 7 days ──┼─ 2 days ─┤ event
 *   T-21            T-7         T-2        T-0
 *
 * Pure, because this is a judgement about how often it is acceptable to write
 * to a guest, and it must be reviewable without a clock or a database.
 */

/** Days before the event at which a reminder goes out, widest first. */
export const REMINDER_MILESTONES: readonly number[] = [21, 7, 2];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The milestone whose window contains `now`, or null when none does.
 *
 * Null means "say nothing": either the event is too far off for even the first
 * nudge, or it has already started, and reminding someone to answer an
 * invitation to a wedding that is under way is worse than silence.
 */
export function dueMilestone(
  startsAt: Date,
  now: Date,
  milestones: readonly number[] = REMINDER_MILESTONES,
): number | null {
  if (now.getTime() >= startsAt.getTime()) return null;

  const widestFirst = [...milestones].sort((a, b) => b - a);

  // The first milestone already crossed is the one that owns this moment:
  // windows are contiguous, so the widest crossed mark is the current one
  // only until the next narrower mark is crossed too.
  const crossed = widestFirst.filter(
    (days) => now.getTime() >= startsAt.getTime() - days * DAY_MS,
  );

  if (crossed.length === 0) return null;

  // The narrowest crossed milestone is the current window: at T-3 both 21 and
  // 7 are crossed, and 7 is the one in force.
  return Math.min(...crossed);
}

/**
 * A stable key for one milestone's reminder to one household.
 *
 * This is what makes the sweep safe to run every hour: the key is the same
 * every time the same milestone is due for the same household, so the outbox's
 * unique constraint turns a hundred runs into one message.
 */
export function milestoneDedupeKey(
  invitationId: string,
  householdId: string,
  milestoneDays: number,
): string {
  return `reminder:${invitationId}:${householdId}:T-${milestoneDays}`;
}

/**
 * A key for a reminder a host sends by hand.
 *
 * Bucketed by day rather than by milestone, which is the rule that reads
 * correctly to both parties: a host may follow up again tomorrow, and a guest
 * cannot be written to twice in one day by someone clicking a button twice.
 */
export function manualDedupeKey(invitationId: string, householdId: string, now: Date): string {
  return `reminder:${invitationId}:${householdId}:${now.toISOString().slice(0, 10)}`;
}

/** The copy every reminder to answer uses, scheduled or sent by hand. */
export const REMINDER_TEMPLATE_KEY = 'rsvp.reminder';

/** "Once a day" for reminders, scheduled and manual together. */
export const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * How long after its invitation a household may first be reminded (decided
 * 10 October 2026, D14): three days, or one when the event is under a week
 * away. A household invited inside a reminder window was otherwise chased
 * within the hour — sometimes before the invitation itself arrived.
 */
export function reminderWaitAfterInvitation(startsAt: Date, now: Date): number {
  return startsAt.getTime() - now.getTime() < 7 * DAY_MS ? DAY_MS : 3 * DAY_MS;
}
