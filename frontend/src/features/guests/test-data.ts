import type { GuestWire, HouseholdWire } from './types';

/**
 * Guests as `GET /events/:eventId/guests` sends them, for tests. The personal link's `token` is
 * never written here: a test that needs one passes a value made at run time (frontend/CLAUDE.md
 * §10), and checks it went nowhere.
 */
export function guestWire(overrides: Partial<GuestWire> = {}): GuestWire {
  return {
    id: 'g1',
    firstName: 'Armen',
    lastName: 'Petrosyan',
    name: 'Armen Petrosyan',
    email: 'armen@example.am',
    phone: '+374 91 000000',
    locale: 'hy',
    attribution: 'SIDE_A',
    isPrimary: true,
    addedByGuest: false,
    isAnonymized: false,
    rsvpStatus: 'ATTENDING',
    table: 'Table 4',
    isCheckedIn: false,
    ...overrides,
  };
}

/** The same guest as a caller without `guest:contact:read` receives them: no email, phone or token. */
export function guestWithoutContact(overrides: Partial<GuestWire> = {}): GuestWire {
  const { email: _email, phone: _phone, token: _token, ...rest } = guestWire(overrides);
  return rest;
}

export function householdWire(overrides: Partial<HouseholdWire> = {}): HouseholdWire {
  const guests = overrides.guests ?? [guestWire()];
  return {
    id: 'h1',
    name: 'Petrosyan family',
    seatsAllotted: 3,
    seatsNamed: guests.length,
    guests,
    ...overrides,
  };
}
