/**
 * A public event's answer as the backend sends it (docs/API.md §5), for the tests. Sample content
 * (design AS-6); no capability token: the tests that need one make it at run time.
 */
const TICKET_TYPES = [
  {
    id: 'general',
    name: 'General',
    description: 'Standing',
    priceMinor: '0',
    currency: 'AMD',
    available: 120,
    minPerOrder: 1,
    maxPerOrder: 10,
    salesEndAt: null,
  },
  {
    id: 'table',
    name: 'Table',
    description: null,
    priceMinor: '15000',
    currency: 'AMD',
    available: 3,
    minPerOrder: 1,
    maxPerOrder: 4,
    salesEndAt: '2027-10-01T20:00:00.000Z',
  },
];

export function publicEventWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: 'autumn-jazz-night',
    locale: 'en',
    availableLocales: ['hy', 'en'],
    headline: 'Autumn Jazz Night',
    summary: 'An evening of jazz in the garden.',
    body: 'Doors open at seven.\n\nThe band starts at eight.',
    categories: ['concert'],
    heroImage: null,
    startsAt: '2027-10-02T15:00:00.000Z',
    endsAt: '2027-10-02T19:00:00.000Z',
    timezone: 'Asia/Yerevan',
    venues: [
      {
        id: 'v-garden',
        name: 'The Garden',
        address: '1 Abovyan St',
        latitude: null,
        longitude: null,
      },
    ],
    ticketTypes: TICKET_TYPES,
    checkout: {
      attendanceMode: 'EVENT_WIDE',
      attendanceRevision: 1,
      venues: [{ id: 'v-garden', name: 'The Garden' }],
      rsvpFields: {
        dietary: { isEnabled: true, options: [{ key: 'vegetarian', label: 'Vegetarian' }] },
        drinkPreference: { isEnabled: false, options: null },
      },
      acknowledgementsRequiredBeforeCheckIn: [],
      questions: [
        {
          id: 'q-meal',
          type: 'SINGLE_CHOICE',
          required: true,
          prompt: 'Your meal',
          options: ['Fish', 'Beef'],
        },
        { id: 'q-song', type: 'TEXT', required: false, prompt: 'A song for the band', options: [] },
      ],
    },
    metadata: {
      title: 'Autumn Jazz Night',
      description: 'An evening of jazz in the garden.',
      imageAssetId: null,
      image: null,
      locale: 'en',
      alternateLocales: ['hy'],
      canonicalPath: '/events/autumn-jazz-night',
      robots: 'noindex,nofollow',
    },
    ...overrides,
  };
}

export function perVenueCheckout(): Record<string, unknown> {
  return {
    attendanceMode: 'PER_VENUE',
    attendanceRevision: 3,
    venues: [
      { id: 'v-church', name: 'Saint Gregory Church' },
      { id: 'v-hall', name: 'Ararat Hall' },
    ],
    rsvpFields: {
      dietary: { isEnabled: false, options: null },
      drinkPreference: { isEnabled: true, options: null },
    },
    acknowledgementsRequiredBeforeCheckIn: [
      { questionId: 'q-rules', prompt: 'I accept the house rules' },
    ],
    questions: [
      {
        id: 'q-meal',
        type: 'SINGLE_CHOICE',
        required: true,
        prompt: 'Your meal',
        options: ['Fish', 'Beef'],
      },
    ],
  };
}
