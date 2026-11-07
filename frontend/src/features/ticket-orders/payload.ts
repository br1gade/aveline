import type { AttendeeBody } from '@/features/checkout';

import type { LinkBody, OrderTicket } from './types';

/** The invited guest's own answers are always kept; checkout's are archived (docs/API.md §5). */
export function linkBody(ticket: OrderTicket, guestId: string): LinkBody {
  return { guestId, expectedGuestId: ticket.guestId, keepExistingAnswers: true };
}

interface CandidateHousehold {
  name: string;
  guests: ReadonlyArray<{ id: string; name: string; isErased: boolean }>;
}

/**
 * The guests a ticket can be linked to: everyone on the list but the erased, who cannot be, and
 * the one already on it. The list does not say who holds a ticket (FR-68), so the backend's
 * refusal says it when it happens.
 */
export function linkCandidates(households: readonly CandidateHousehold[], ticket: OrderTicket) {
  return households.flatMap((household) =>
    household.guests
      .filter((guest) => !guest.isErased && guest.id !== ticket.guestId)
      .map((guest) => ({ guestId: guest.id, label: `${guest.name} (${household.name})` })),
  );
}

/**
 * Registering who holds a legacy ticket: one person, by checkout's own rules, for this ticket's
 * type, with the current attendance revision. Never a household key: the backend refuses one.
 */
export function registerBody(attendee: AttendeeBody, attendanceRevision: number) {
  return { attendee, attendanceRevision };
}
