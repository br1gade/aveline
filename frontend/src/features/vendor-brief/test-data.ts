import type { BriefWire } from './types';

export { plantedToken } from '../../../test/tokens';

const COUNTS = { invited: 60, attending: 45, declined: 5, undecided: 2, pending: 8 };

/** Every section's contents, as the backend's builders send them. */
const SECTIONS = {
  headcount: {
    ...COUNTS,
    invited: 120,
    attending: 90,
    households: 40,
    responseRate: 88,
    bySide: [{ side: 'SIDE_A', ...COUNTS }],
    venues: [],
  },
  catering: {
    covers: 90,
    requirements: [{ requirement: 'Vegetarian', count: 6 }],
    notes: [{ guest: 'Ani K', household: 'Karapetyan', note: 'No nuts' }],
  },
  bar: { totalResponses: 70, preferences: [{ drink: 'Wine', guests: 40 }] },
  playlist: { tracks: [{ track: 'Sirun Yar', requests: 5 }] },
  timeline: [{ label: 'Ceremony', occursAt: '2027-06-12T12:00:00.000Z', venue: 'Garden hall' }],
  seating: [
    {
      name: 'Table 1',
      capacity: 10,
      zone: null,
      venue: 'Garden hall',
      seated: 8,
      guests: [{ name: 'Ani K' }],
      released: [],
    },
  ],
  households: [{ household: 'Karapetyan', guests: ['Ani K', 'Aram K'] }],
  contacts: [
    { name: 'Ani K', email: 'ani@example.am', phone: '+374 91 000000' },
    { name: 'Aram K', email: null, phone: null },
  ],
} satisfies Partial<BriefWire>;

/**
 * A brief as the backend sends it, for tests, with every section granted unless a test narrows
 * `granted`. Times are 12:00 UTC, 16:00 in Yerevan, the event's zone.
 */
export function briefWire(overrides: Partial<BriefWire> = {}): BriefWire {
  return {
    vendor: { name: 'Tashir Catering', category: 'CATERING' },
    status: 'CONFIRMED',
    event: {
      title: 'Anna & Davit',
      startsAt: '2027-06-12T12:00:00.000Z',
      endsAt: '2027-06-12T20:00:00.000Z',
      timezone: 'Asia/Yerevan',
      venues: [
        {
          role: 'RECEPTION',
          name: 'Garden hall',
          address: '1 Abovyan St',
          arriveAt: '2027-06-12T11:30:00.000Z',
          mapUrl: 'https://maps.example/garden',
        },
      ],
    },
    granted: [
      { section: 'headcount', purpose: 'Confirmed headcount by side' },
      { section: 'catering', purpose: 'Covers and dietary requirements' },
      { section: 'bar', purpose: 'Drink preferences as quantities' },
      { section: 'playlist', purpose: 'Requested songs' },
      { section: 'timeline', purpose: 'Running order and access times' },
      { section: 'seating', purpose: 'Tables, capacities and who sits where' },
      { section: 'households', purpose: 'Guests grouped by household' },
      { section: 'contacts', purpose: 'Guest emails and phone numbers' },
    ],
    ...SECTIONS,
    ...overrides,
  };
}
