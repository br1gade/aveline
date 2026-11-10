import type { DoorGuest, DoorHousehold } from './types';

/** Someone on the roster as the door reads them; each test names what matters to it. */
export function doorGuest(id: string, name: string, overrides: Partial<DoorGuest> = {}): DoorGuest {
  return {
    id,
    name,
    householdName: name,
    answer: 'ATTENDING',
    arrivedAt: null,
    seats: [],
    isErased: false,
    ...overrides,
  };
}

/** People grouped as the door groups them, by their household's name. */
export function doorHousehold(name: string, guests: DoorGuest[]): DoorHousehold {
  return { name, guests: guests.map((guest) => ({ ...guest, householdName: name })) };
}
