import type { DeliveryReport } from './types';

/** The most guest ids one send takes (`SendInvitationDto`, `@ArrayMaxSize(1000)`). */
export const SEND_LIMIT = 1000;

/**
 * Whether this send is the event's first, which asks once before going (design PD-47): nothing
 * has been sent to any household yet, or the report could not be read, so nobody can tell. After
 * that a press sends at once; the backend makes a second press safe (docs/API.md §6).
 */
export function needsConfirmation(report: DeliveryReport | null): boolean {
  return report === null || report.invited === 0;
}

export type ChosenGuests = { kind: 'ready'; guestIds: string[] } | { kind: 'tooMany' };

/**
 * One guest of each chosen household: naming any member invites the whole household, which is
 * the unit an invitation goes to (docs/API.md §6). A household always has a guest; the backend
 * removes an empty one.
 */
export function guestIdsFor(
  households: ReadonlyArray<{ guests: ReadonlyArray<{ id: string }> }>,
): ChosenGuests {
  if (households.length > SEND_LIMIT) return { kind: 'tooMany' };
  const guestIds = households.flatMap(({ guests }) => (guests[0] ? [guests[0].id] : []));
  return { kind: 'ready', guestIds };
}
