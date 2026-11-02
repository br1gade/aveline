import type { Listing, TicketType } from './types';

/** A ticket type as read (docs/API.md §5), for the tests: 12 sold and 2 held of 200. */
export function ticketType(overrides: Partial<TicketType> = {}): TicketType {
  return {
    id: 'general',
    name: { en: 'General', hy: 'Ընդհանուր' },
    description: {},
    priceMinor: '15000',
    currency: 'AMD',
    quantityTotal: 200,
    sold: 12,
    held: 2,
    available: 186,
    minPerOrder: 1,
    maxPerOrder: 10,
    salesStartAt: null,
    salesEndAt: '2027-10-01T20:00:00.000Z',
    isActive: true,
    ...overrides,
  };
}

/** A listing as read, unpublished. */
export function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    slug: 'autumn-jazz-night',
    headline: { en: 'Autumn Jazz Night' },
    summary: {},
    body: {},
    ogTitle: {},
    ogDescription: {},
    categories: ['concert'],
    isIndexable: false,
    heroAssetId: null,
    ogImageId: null,
    publishedAt: null,
    ...overrides,
  };
}
