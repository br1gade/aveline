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

/**
 * A key that confirms each answer once, but still confirms a changed one.
 *
 * Bucketed by minute and keyed on the answer. A double-submitted form — two
 * identical answers seconds apart — produces one confirmation; changing from
 * attending to declined produces a second, because that is a new answer the
 * guest deserves to see acknowledged; giving the same answer again an hour
 * later is a new submission and confirms again.
 */
export function confirmationDedupeKey(
  householdId: string,
  status: RsvpStatus,
  now: Date,
): string {
  return `rsvp-confirm:${householdId}:${status}:${now.toISOString().slice(0, 16)}`;
}
