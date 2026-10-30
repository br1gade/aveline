import type { ArrangementWire, JobWire, TableWire } from './types';

/**
 * The seating answers as the backend sends them, for tests: two venues guests see, a preparation
 * venue and the plan without one. No guest's token is written here; the guest list a test serves
 * carries one made at run time, and the test checks it went nowhere.
 */
export const EVENT = {
  id: 'e1',
  title: 'The wedding of Anna and Davit',
  type: 'WEDDING',
  hostsLabel: 'Anna & Davit',
  startsAt: '2027-06-12T11:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  locales: ['hy', 'en'],
  defaultLocale: 'hy',
  sideALabel: null,
  sideBLabel: null,
  invitation: { slug: 'anna-davit', status: 'PUBLISHED' },
  attendanceMode: 'EVENT_WIDE',
  attendanceRevision: 1,
  seatingPublishedAt: null as string | null,
  venues: [
    { id: 'church', role: 'CEREMONY' },
    { id: 'hall', role: 'RECEPTION' },
    { id: 'salon', role: 'PREPARATION' },
  ],
  timeline: [],
};

export function arrangementWire(
  id: string,
  venueId: string | null,
  overrides: Partial<ArrangementWire> = {},
): ArrangementWire {
  return {
    id,
    venueId,
    revision: 1,
    venue: venueId
      ? { name: venueId === 'hall' ? 'Hall' : `Venue ${venueId}`, capacity: null }
      : null,
    _count: { tables: 0 },
    ...overrides,
  };
}

export const ARRANGEMENTS: ArrangementWire[] = [
  arrangementWire('a-hall', 'hall', { revision: 5, _count: { tables: 3 } }),
  arrangementWire('a-salon', 'salon'),
  { ...arrangementWire('a-church', 'church'), venue: { name: 'Church', capacity: null } },
  arrangementWire('a-none', null),
];

function seated(
  guestId: string,
  name: string,
  extra: { position?: number; isReservation?: boolean } = {},
) {
  return {
    guestId,
    name,
    position: extra.position ?? null,
    isReservation: extra.isReservation ?? false,
  };
}

/** Hall's tables, in the API's order, by name as text: 1, 10, 2. */
export const TABLES: TableWire[] = [
  {
    id: 't1',
    arrangementId: 'a-hall',
    name: 'Table 1',
    capacity: 2,
    zone: null,
    guests: [],
    released: [{ guestId: 'g6', name: 'Mariam Sargsyan', releasedAt: '2027-05-03T08:00:00.000Z' }],
  },
  {
    id: 't10',
    arrangementId: 'a-hall',
    name: 'Table 10',
    capacity: 10,
    zone: null,
    guests: [seated('g1', 'Armen Petrosyan', { position: 3 }), seated('g8', 'Gor Petrosyan')],
    released: [],
  },
  {
    id: 't2',
    arrangementId: 'a-hall',
    name: 'Table 2',
    capacity: 4,
    zone: 'Terrace',
    guests: [seated('g2', 'Lusine Petrosyan', { isReservation: true })],
    released: [],
  },
];

export function jobWire(overrides: Partial<JobWire> = {}): JobWire {
  return {
    id: 'j1',
    arrangementId: 'a-hall',
    status: 'QUEUED',
    attempts: 0,
    failureReason: null,
    recovery: null,
    appliedRevision: null,
    createdAt: '2027-06-01T08:00:00.000Z',
    completedAt: null,
    result: null,
    ...overrides,
  };
}
