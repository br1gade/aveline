import { isSafeAddress, isUsableEmailAddress, normalizeEmailAddress } from '../../common/address';

/**
 * The rules a host's edits to the guest list must respect.
 *
 * Pure so the decisions are testable in one place. Two of them were decided
 * with the product owner; the rest follow from rules that already exist
 * elsewhere and must agree with them.
 */

/**
 * Whether a guest may be removed.
 *
 * Decided: a guest can be removed along with their answer and seat — the
 * headcount and catering sheet update — **unless they were checked in**,
 * because that is the record that they came.
 */
export function removalProblem(guest: { checkedIn: boolean; anonymized: boolean }): string | null {
  if (guest.checkedIn) {
    return 'This guest was checked in at the door, which is the record that they came; they cannot be removed';
  }
  return null;
}

/**
 * Whether a household can hold this many named guests.
 *
 * The same rule the RSVP form enforces when a guest adds their own party, so a
 * host and a guest cannot disagree about how many seats a household has.
 */
export function capacityProblem(seatsAllotted: number, namedGuests: number): string | null {
  if (namedGuests > seatsAllotted) {
    return `This household has ${seatsAllotted} seat(s) and would have ${namedGuests} guests; raise seatsAllotted first`;
  }
  return null;
}

/**
 * An address as the host typed it, ready to store — or the reason it cannot be.
 *
 * Empty clears it. Everything else goes through the same validator as CSV
 * import, because an address typed by a host reaches the same mail transport:
 * a carriage return in it is an injected SMTP command whichever form it came
 * from.
 */
export type AddressInput =
  | { kind: 'unchanged' }
  | { kind: 'clear' }
  | { kind: 'set'; value: string }
  | { kind: 'invalid'; message: string };

export function readEmail(raw: string | undefined): AddressInput {
  if (raw === undefined) return { kind: 'unchanged' };
  if (raw.trim() === '') return { kind: 'clear' };
  if (!isUsableEmailAddress(raw)) {
    return { kind: 'invalid', message: `email: "${raw.trim()}" does not look like an email address` };
  }
  return { kind: 'set', value: normalizeEmailAddress(raw) };
}

export function readPhone(raw: string | undefined): AddressInput {
  if (raw === undefined) return { kind: 'unchanged' };
  if (raw.trim() === '') return { kind: 'clear' };
  if (!isSafeAddress(raw) || !/^\+?[\d\s()-]{6,}$/.test(raw.trim())) {
    return { kind: 'invalid', message: `phone: "${raw.trim()}" does not look like a phone number` };
  }
  return { kind: 'set', value: raw.trim() };
}

/** The value to write, given what the host sent. `undefined` leaves it alone. */
export function toColumn(input: AddressInput): string | null | undefined {
  if (input.kind === 'set') return input.value;
  if (input.kind === 'clear') return null;
  return undefined;
}
