import { RsvpStatus } from '@prisma/client';

/**
 * Which copy confirms which answer.
 *
 * One template per answer rather than one template with the answer
 * interpolated: "we look forward to seeing you" and "sorry you can't make it"
 * are different messages, and translating a sentence assembled in code from
 * a status word produces Armenian no Armenian would write.
 *
 * A table, so adding an answer is adding a row. PENDING is absent on purpose —
 * it is the state before anyone has answered, not an answer.
 */
export const CONFIRMATION_TEMPLATE: Readonly<Partial<Record<RsvpStatus, string>>> = {
  [RsvpStatus.ATTENDING]: 'rsvp.confirmation.attending',
  [RsvpStatus.DECLINED]: 'rsvp.confirmation.declined',
  [RsvpStatus.UNDECIDED]: 'rsvp.confirmation.undecided',
};

export function confirmationTemplateFor(status: RsvpStatus): string | null {
  return CONFIRMATION_TEMPLATE[status] ?? null;
}

/** The answer a confirmation template confirms, read back from a queued message. */
export function statusConfirmedBy(templateKey: string): RsvpStatus | null {
  const entry = Object.entries(CONFIRMATION_TEMPLATE).find(([, key]) => key === templateKey);
  return entry ? (entry[0] as RsvpStatus) : null;
}

/**
 * The key for this answer's confirmation, or null when there is nothing new
 * to confirm.
 *
 * `earlierThisMinute` is the household's confirmations already queued this
 * minute, newest first. The same answer as the last of them is a
 * double-submitted form: nothing to send. Any other answer is new, and its
 * key carries how many came before it this minute — so attending, declined,
 * attending again confirms all three, ending on the answer that stands. Keyed
 * by answer and minute alone, the third reused the first's key and was
 * dropped (B60). Concurrent identical submissions read the same history and
 * agree on one key, so the outbox's unique key still sends one.
 */
export function confirmationDedupeKey(
  householdId: string,
  status: RsvpStatus,
  now: Date,
  earlierThisMinute: RsvpStatus[],
): string | null {
  if (earlierThisMinute[0] === status) return null;
  return `rsvp-confirm:${householdId}:${status}:${now.toISOString().slice(0, 16)}:${earlierThisMinute.length}`;
}
