import type { CheckoutRules, PublicEvent } from '@/features/public-event';

/** Checkout's rules for an event answered once, as `GET /public/events/:slug` gives them. */
export const EVENT_WIDE_RULES: CheckoutRules = {
  attendanceMode: 'EVENT_WIDE',
  attendanceRevision: 1,
  venues: [{ id: 'v-garden', name: 'The Garden' }],
  dietary: { isEnabled: true, options: [{ key: 'vegetarian', label: 'Vegetarian' }] },
  drink: { isEnabled: false, options: null },
  questions: [
    {
      id: 'q-meal',
      type: 'SINGLE_CHOICE',
      required: true,
      prompt: 'Your meal',
      options: ['Fish', 'Beef'],
    },
    { id: 'q-song', type: 'TEXT', required: false, prompt: 'A song for the band', options: [] },
    { id: 'q-allergy', type: 'BOOLEAN', required: false, prompt: 'Any allergy?', options: [] },
    {
      id: 'q-extras',
      type: 'MULTI_CHOICE',
      required: false,
      prompt: 'Extras',
      options: ['Cake', 'Wine', 'Taxi'],
    },
  ],
  agreementsBeforeDoor: [],
};

/** The same per venue, with free-text drinks and an agreement asked before the door. */
export const PER_VENUE_RULES: CheckoutRules = {
  attendanceMode: 'PER_VENUE',
  attendanceRevision: 3,
  venues: [
    { id: 'v-church', name: 'Saint Gregory Church' },
    { id: 'v-hall', name: 'Ararat Hall' },
  ],
  dietary: { isEnabled: false, options: null },
  drink: { isEnabled: true, options: null },
  questions: [
    {
      id: 'q-meal',
      type: 'SINGLE_CHOICE',
      required: true,
      prompt: 'Your meal',
      options: ['Fish', 'Beef'],
    },
  ],
  agreementsBeforeDoor: [{ questionId: 'q-rules', prompt: 'I accept the house rules' }],
};

/** A public event as checkout receives it, read (sample content, design AS-6). */
export const EVENT: PublicEvent = {
  slug: 'autumn-jazz-night',
  locale: 'en',
  availableLocales: ['hy', 'en'],
  headline: 'Autumn Jazz Night',
  summary: null,
  body: null,
  heroImage: null,
  startsAt: '2027-10-02T15:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  venues: [{ id: 'v-garden', name: 'The Garden', address: null }],
  ticketTypes: [
    {
      id: 'general',
      name: 'General',
      description: null,
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
      salesEndAt: null,
    },
  ],
  checkout: EVENT_WIDE_RULES,
  metadata: {
    title: null,
    description: null,
    image: null,
    locale: 'en',
    alternateLocales: [],
    canonicalPath: '/events/autumn-jazz-night',
    robots: 'noindex,nofollow',
  },
};
