import type { CheckoutRules } from '@/features/public-event';

import type { PersonValues, VenueStatus } from './types';

/**
 * Each person's attendance, as checkout takes it (docs/API.md §5). Answered once for the event,
 * buying a ticket means coming: nothing is sent and the backend records ATTENDING. Answered per
 * venue, each person chooses at each venue for themselves; no status is sent, unanswered venues
 * stay pending, and at least one must be answered.
 */
function answered(rules: CheckoutRules, person: PersonValues) {
  return rules.venues.flatMap((venue) => {
    const status = person.venues[venue.id];
    return status ? [{ venueId: venue.id, status: status satisfies VenueStatus }] : [];
  });
}

export function attendanceBody(
  rules: CheckoutRules,
  person: PersonValues,
): { venueAttendance?: Array<{ venueId: string; status: VenueStatus }> } {
  return rules.attendanceMode === 'PER_VENUE' ? { venueAttendance: answered(rules, person) } : {};
}

export function hasVenueAnswer(rules: CheckoutRules, person: PersonValues): boolean {
  return rules.attendanceMode !== 'PER_VENUE' || answered(rules, person).length > 0;
}

/**
 * Whether this person is coming, which decides whether the host's required questions bind them.
 * Per venue, coming anywhere is coming, as the backend sums it up (`summarizeAttendance`).
 */
export function isComing(rules: CheckoutRules, person: PersonValues): boolean {
  return (
    rules.attendanceMode !== 'PER_VENUE' ||
    answered(rules, person).some((answer) => answer.status === 'ATTENDING')
  );
}
