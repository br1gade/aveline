import { plantedToken } from '../../../test/tokens';

import type { BookingWire, VendorWire } from './types';

/**
 * The vendor answers as the backend sends them, for tests. No brief token is written here: each
 * test makes its own at run time and checks it went nowhere but where it should (CLAUDE.md §10).
 */
export const EVENT = {
  id: 'e1',
  organizationId: 'o1',
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
  invitation: null,
};

export { plantedToken };

/** The backend leaves a field out, rather than sending it empty, for a role not given it. */
export function without<T extends object>(value: T, ...keys: Array<keyof T>): T {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

export function vendorWire(overrides: Partial<VendorWire> = {}): VendorWire {
  return {
    id: 'v1',
    name: 'Tashir Catering',
    category: 'CATERING',
    email: 'hello@tashir.example',
    phone: '+374 10 000000',
    notes: null,
    isCurated: false,
    venueProfile: null,
    venueProfiles: [],
    ...overrides,
  };
}

export function bookingWire(overrides: Partial<BookingWire> = {}): BookingWire {
  return {
    id: 'b1',
    vendor: { id: 'v1', name: 'Tashir Catering', category: 'CATERING', email: null, phone: null },
    status: 'ENQUIRED',
    briefScopes: ['headcount', 'catering', 'timeline'],
    briefToken: plantedToken(),
    feeMinor: '150000',
    feeCurrency: 'AMD',
    isBriefEnabled: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

/** The event's choices as `GET …/vendor-options` gives a page of them (FR-103, FR-105). */
export function optionsWire(
  items: Array<{ id: string; name: string; category: VendorWire['category']; isCurated: boolean }>,
  over: { offset?: number; hasMore?: boolean } = {},
) {
  return {
    items,
    total: items.length,
    limit: 100,
    offset: over.offset ?? 0,
    hasMore: over.hasMore ?? false,
    sections: [],
    defaults: [
      { category: 'CATERING', scopes: ['timeline', 'headcount', 'catering'] },
      { category: 'PHOTOGRAPHY', scopes: ['households', 'timeline'] },
    ],
  };
}
