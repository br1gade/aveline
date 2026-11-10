import type { Guest, Household } from '@/features/guests';
import type { AgreementRecordWire } from './types';

/** One agreement as the backend sends it: Armen agreed for himself, typed. */
export function recordWire(overrides: Partial<AgreementRecordWire> = {}): AgreementRecordWire {
  return {
    id: 'a1',
    questionId: 'q-photos',
    statementVersionId: 'v2',
    subjectGuestId: 'g1',
    signerGuestId: 'g1',
    signerName: 'Armen Petrosyan',
    method: 'TYPED',
    isRepresentative: false,
    locale: 'en',
    statement: 'Photos may be shared',
    mediaId: null,
    createdAt: '2027-05-01T09:30:00.000Z',
    ...overrides,
  };
}

/** Someone on the guest list, for the agreements page's helpers; each test names what matters. */
export function listedGuest(id: string, name: string, overrides: Partial<Guest> = {}): Guest {
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

export function listedHousehold(id: string, name: string, guests: Guest[]): Household {
  return { id, name, seatsAllotted: guests.length, seatsNamed: guests.length, guests };
}
