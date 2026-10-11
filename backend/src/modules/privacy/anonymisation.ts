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
 * What a guest told us about themselves, cleared on erasure.
 *
 * Their own words — a guest-book message signed with a name, a dietary note
 * naming a condition, a song dedication, a drink preference — and, decided 9
 * October 2026, their dietary tags too. A tag like "halal" or "kosher" is
 * special-category data under GDPR, and an anonymised row in a named
 * household could still point at the person. What stays is whether they came:
 * the headcount the caterer was paid for does not change, though the
 * requirement counts drop by theirs.
 */
export const ERASED_RSVP_FIELDS = {
  message: null,
  dietaryNotes: null,
  songRequest: null,
  drinkPreference: null,
  dietary: [],
};

/**
 * Whether a household's name still names someone who was erased (D20).
 *
 * "Anna & Davit" names Anna; a household of nobody but erased people names
 * them whatever it says. A family name is different: "Hakobyan family" is
 * also the name of the Hakobyans still invited, so it goes only when nobody
 * left could be one — a remaining guest with no last name might be.
 */
export function isNamedAfter(
  householdName: string,
  erased: { firstName: string; lastName: string | null }[],
  remaining: { lastName: string | null }[],
): boolean {
  if (remaining.length === 0) return true;
  const words = new Set(householdName.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const named = (name: string | null) => Boolean(name) && words.has((name as string).toLocaleLowerCase());
  const familyKept = (lastName: string) =>
    remaining.some((guest) => guest.lastName === null || guest.lastName.toLocaleLowerCase() === lastName.toLocaleLowerCase());

  return erased.some((person) => named(person.firstName) || (named(person.lastName) && !familyKept(person.lastName as string)));
}

/** "Household 4", one past the highest such number the event already uses. */
export function nextHouseholdName(existingNames: string[]): string {
  const numbers = existingNames.map((name) => /^Household (\d+)$/.exec(name)?.[1]).filter(Boolean).map(Number);
  return `Household ${Math.max(0, ...numbers) + 1}`;
}
