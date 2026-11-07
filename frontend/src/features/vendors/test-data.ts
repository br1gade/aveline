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
    isCurated: false,
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
    ...overrides,
  };
}
