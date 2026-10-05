/**
 * What erasure removes and what it keeps.
 *
 * GDPR Article 17 requires the personal data to go. It does not require the
 * event's history to be falsified: a wedding that had 96 covers still had 96
 * covers, and the caterer's invoice says so. So the identifying fields are
 * cleared and the structural ones — the household, the seat, the response —
 * stay, which keeps every headcount, catering sheet and paid invoice
 * consistent with what actually happened.
 *
 * Pure, because "which fields are personal" is a legal judgement that must be
 * reviewable in one place and testable without a database.
 */
export interface AnonymisedGuest {
  firstName: string;
  lastName: null;
  email: null;
  phone: null;
  token: string;
  anonymizedAt: Date;
}

/** The placeholder a sheet shows where a name used to be. */
export const ERASED_NAME = 'Removed';

export function anonymisedGuestFields(newToken: string, now: Date): AnonymisedGuest {
  return {
    // Not an empty string: a blank cell in a seating chart reads as a bug,
    // and the row must still be countable.
    firstName: ERASED_NAME,
    lastName: null,
    email: null,
    phone: null,
    // The old invitation link is itself personal data — it identifies them and
    // would still open their RSVP. Replacing it revokes it.
    token: newToken,
    anonymizedAt: now,
  };
}

/**
 * The free-text fields a guest wrote themselves.
 *
 * A guest-book message signed with a name, a dietary note naming a medical
 * condition and a song dedication are all personal data the guest supplied,
 * so erasure clears them. The RSVP's status and dietary tags stay: a tag like
 * "vegan" against an anonymous row feeds the catering sheet and identifies
 * nobody.
 */
export const ERASED_RSVP_FIELDS = {
  message: null,
  dietaryNotes: null,
  songRequest: null,
} as const;
