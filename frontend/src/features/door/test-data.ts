import type { Guest, Household } from '@/features/guests';

/** Someone on the list as the door reads them; each test names what matters to it. */
export function doorGuest(id: string, name: string, overrides: Partial<Guest> = {}): Guest {
  const [firstName = name, lastName = null] = name.split(' ');
  return {
    id,
    firstName,
    lastName,
    name,
    locale: null,
    side: 'UNKNOWN',
    isPrimary: true,
    isAddedByGuest: false,
    isErased: false,
    answer: 'ATTENDING',
    table: null,
    seats: [],
    releases: [],
    venueAnswers: [],
    isAskedAgain: false,
    isCheckedIn: false,
    arrivedAt: null,
    contact: { isShown: false },
    ...overrides,
  };
}

export function doorHousehold(id: string, name: string, guests: Guest[]): Household {
  return { id, name, seatsAllotted: guests.length, seatsNamed: guests.length, guests };
}
