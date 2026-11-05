import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError, type FieldFeedback } from '@/api/errors';

import { briefUrl, isSendableOrigin } from './brief-link';
import { bookingChanges, bookingEditValues, bookingPayload, newVendorPayload } from './payload';
import { readBookings, readVendors } from './read';
import { vendorRefusalOf } from './refusals';
import { feeProblem, vendorFormSchema } from './schemas';
import { BRIEF_SECTIONS, inSectionOrder, USUAL_SECTIONS, VENDOR_CATEGORIES } from './scopes';
import { bookingWire, plantedToken, vendorWire, without } from './test-data';
import type { Booking, BookingWire } from './types';
import { ADDRESSES_NOBODY_TAKES, ADDRESSES_THE_BACKEND_TAKES } from '../../../test/emails';

const backend = (path: string) =>
  readFileSync(join(process.cwd(), '..', 'backend', 'src', path), 'utf8');

function booking(
  overrides: Partial<BookingWire> = {},
  ...absent: Array<keyof BookingWire>
): Booking {
  const [read] = readBookings([without(bookingWire(overrides), ...absent)]);
  if (!read) throw new Error('No booking');
  return read;
}

function apiError(
  status: number,
  messages: string[] = ['refused'],
  code?: string,
  fields: FieldFeedback[] = [],
) {
  return new ApiError({
    status,
    messages,
    requestId: `r-${status}`,
    feedback: { code, action: undefined, userMessage: undefined, details: fields },
  });
}

describe('the brief sections and the usual set for each kind of vendor (FR-105 stand-in)', () => {
  const source = backend('modules/vendors/vendor-brief.ts');

  it('lists the sections in the backend’s order', () => {
    const list = /BRIEF_SECTIONS = \[([^\]]+)\]/.exec(source)?.[1] ?? '';
    expect([...list.matchAll(/'(\w+)'/g)].map((match) => match[1])).toEqual([...BRIEF_SECTIONS]);
  });

  it('presets exactly the backend’s usual set for every category', () => {
    for (const category of VENDOR_CATEGORIES) {
      const row = new RegExp(`${category}: \\[([^\\]]*)\\]`).exec(source)?.[1] ?? '';
      const usual = [...row.matchAll(/'(\w+)'/g)].map((match) => match[1]);
      expect([...USUAL_SECTIONS[category]].sort()).toEqual(usual.sort());
    }
  });

  it('offers every category the database knows, and never presets guests’ contacts', () => {
    const schema = readFileSync(
      join(process.cwd(), '..', 'backend', 'prisma', 'schema.prisma'),
      'utf8',
    );
    const block = /enum VendorCategory \{([^}]+)\}/.exec(schema)?.[1] ?? '';
    expect([...VENDOR_CATEGORIES].sort()).toEqual(block.trim().split(/\s+/).sort());
    for (const category of VENDOR_CATEGORIES) {
      expect(USUAL_SECTIONS[category]).not.toContain('contacts');
    }
  });

  it('puts what is ticked in the backend’s order, once each, dropping the unknown', () => {
    expect(inSectionOrder(['timeline', 'contacts', 'headcount', 'timeline', 'guestlist'])).toEqual([
      'headcount',
      'timeline',
      'contacts',
    ]);
  });
});

describe('reading the vendors', () => {
  it('keeps who keeps each vendor, its contact details and its halls', () => {
    const [vendor] = readVendors([
      vendorWire({
        isCurated: true,
        category: 'VENUE',
        venueProfiles: [{ id: 'h1', name: 'Garden hall', city: 'Yerevan', capacity: 300 }],
      }),
    ]);
    expect(vendor).toEqual({
      id: 'v1',
      name: 'Tashir Catering',
      category: 'VENUE',
      email: 'hello@tashir.example',
      phone: '+374 10 000000',
      isCurated: true,
      halls: [{ id: 'h1', name: 'Garden hall', city: 'Yerevan', capacity: 300 }],
    });
  });

  it('reads no halls as none, and a category it does not know as “other”', () => {
    const [vendor] = readVendors([without(vendorWire({ category: 'FLORIST' }), 'venueProfiles')]);
    expect(vendor?.halls).toEqual([]);
    expect(vendor?.category).toBe('OTHER');
  });
});

describe('reading the bookings', () => {
  it('tells a fee withheld from this role apart from no fee agreed', () => {
    expect(booking({}, 'feeMinor', 'feeCurrency').fee).toEqual({ isShown: false });
    expect(booking({ feeMinor: null }).fee).toEqual({
      isShown: true,
      amountMinor: null,
      currency: 'AMD',
    });
    expect(booking({ feeMinor: '9007199254740993' }).fee).toEqual({
      isShown: true,
      amountMinor: '9007199254740993',
      currency: 'AMD',
    });
  });

  it('holds the brief link only when the role was given it', () => {
    const token = plantedToken();
    expect(booking({ briefToken: token }).link).toEqual({ isShown: true, token });
    expect(booking({}, 'briefToken').link).toEqual({ isShown: false });
  });

  it('keeps the vendor’s contact details, the sections in order and a known status', () => {
    const read = booking({
      vendor: { id: 'v1', name: 'Lens', category: 'PHOTOGRAPHY', email: 'a@b.example', phone: '1' },
      briefScopes: ['households', 'timeline'],
      status: 'CONFIRMED',
    });
    expect(read.vendor).toEqual({
      id: 'v1',
      name: 'Lens',
      category: 'PHOTOGRAPHY',
      email: 'a@b.example',
      phone: '1',
    });
    expect(read.scopes).toEqual(['timeline', 'households']);
    expect(read.status).toBe('CONFIRMED');
  });

  it('keeps nothing it does not name, so a token the backend added goes no further', () => {
    const planted = plantedToken();
    const wire = { ...without(bookingWire(), 'briefToken'), guestToken: planted, notes: planted };
    expect(JSON.stringify(readBookings([wire]))).not.toContain(planted);
  });
});

describe('the fee as typed', () => {
  it.each([
    ['', null],
    ['0', null],
    ['150000', null],
    ['999999999999999', null],
    [' 150000 ', null],
    ['1000000000000000', 'feeTooLarge'],
    ['150000.50', 'fee'],
    ['1 500', 'fee'],
    ['-5', 'fee'],
    ['1e5', 'fee'],
  ])('reads %j in dram as %s', (input, problem) => {
    expect(feeProblem(input, 'AMD')).toBe(problem);
  });
});

describe('the payloads', () => {
  it('adds a vendor with its words trimmed and empty details left out', () => {
    expect(
      newVendorPayload({ name: '  Lens  ', category: 'PHOTOGRAPHY', email: ' ', phone: ' 1 ' }),
    ).toEqual({ name: 'Lens', category: 'PHOTOGRAPHY', phone: '1' });
  });

  it('books with every section ticked sent, in order, and the fee in minor units', () => {
    expect(
      bookingPayload({ vendorId: 'v1', scopes: ['timeline', 'headcount'], fee: ' 150000 ' }),
    ).toEqual({ vendorId: 'v1', briefScopes: ['headcount', 'timeline'], feeMinor: '150000' });
  });

  it('sends an empty section list rather than leaving the backend’s default to decide', () => {
    expect(bookingPayload({ vendorId: 'v1', scopes: [], fee: '' })).toEqual({
      vendorId: 'v1',
      briefScopes: [],
    });
  });

  it('starts a correction from the booking as it is', () => {
    expect(bookingEditValues(booking())).toEqual({
      status: 'ENQUIRED',
      scopes: ['headcount', 'catering', 'timeline'],
      fee: '150000',
    });
    expect(bookingEditValues(booking({ feeMinor: null })).fee).toBe('');
  });

  it('sends only what changed', () => {
    const current = booking();
    expect(bookingChanges(current, bookingEditValues(current))).toEqual({});
    expect(
      bookingChanges(current, {
        status: 'QUOTED',
        scopes: ['timeline', 'catering', 'headcount'],
        fee: '150000',
      }),
    ).toEqual({ status: 'QUOTED' });
    expect(
      bookingChanges(current, { status: 'ENQUIRED', scopes: ['headcount'], fee: '200000' }),
    ).toEqual({ briefScopes: ['headcount'], feeMinor: '200000' });
  });

  it('sends a first fee, and never a fee to a role that cannot read it', () => {
    expect(
      bookingChanges(booking({ feeMinor: null }), {
        status: 'ENQUIRED',
        scopes: ['headcount', 'catering', 'timeline'],
        fee: '5000',
      }),
    ).toEqual({ feeMinor: '5000' });
    expect(
      bookingChanges(booking({}, 'feeMinor', 'feeCurrency'), {
        status: 'ENQUIRED',
        scopes: ['headcount', 'catering', 'timeline'],
        fee: '5000',
      }),
    ).toEqual({});
  });
});

describe('the add form', () => {
  const valid = { name: 'Lens', category: 'PHOTOGRAPHY', email: '', phone: '' } as const;

  it.each([
    [{ name: ' L ' }, 'name', 'nameShort'],
    [{ name: 'x'.repeat(161) }, 'name', 'tooLong'],
    [{ category: '' }, 'category', 'required'],
    [{ email: 'not an address' }, 'email', 'email'],
    [{ phone: '1'.repeat(41) }, 'phone', 'tooLong'],
    [{ email: `${'a'.repeat(190)}@example.am` }, 'email', 'tooLong'],
  ])('refuses %j on %s', (change, field, message) => {
    const result = vendorFormSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: [field], message }),
    );
  });

  it('takes two characters, 160, no details, an email of 200 and a phone of 40', () => {
    expect(vendorFormSchema.safeParse({ ...valid, name: 'Lo' }).success).toBe(true);
    expect(vendorFormSchema.safeParse({ ...valid, name: 'x'.repeat(160) }).success).toBe(true);
    const email = `${'a'.repeat(189)}@example.am`;
    expect(email).toHaveLength(200);
    expect(vendorFormSchema.safeParse({ ...valid, email }).success).toBe(true);
    expect(vendorFormSchema.safeParse({ ...valid, phone: '1'.repeat(40) }).success).toBe(true);
  });
});

describe('the brief link', () => {
  it('is built on this client’s own address, at the route the vendor opens', () => {
    const token = plantedToken();
    expect(briefUrl('https://app.example', token)).toBe(`https://app.example/briefs/${token}`);
  });
});

describe('where a brief link may be sent from', () => {
  it.each([
    ['https://app.aveline.am', 'https://app.aveline.am/app/events/e1/vendors/b1', true],
    ['http://localhost:5173', 'http://localhost:5173/app', true],
    ['http://localhost:5173', 'https://app.aveline.am/app', false],
    ['http://127.0.0.1:5173', 'https://app.aveline.am/app', false],
    ['http://app.aveline.am', 'https://app.aveline.am/app', false],
    ['http://staging.aveline.test', 'http://staging.aveline.test/app', true],
    ['http://localhost:5173', 'http://staging.aveline.test/app', false],
    ['https://localhost:5173', 'https://app.aveline.am/app', false],
  ])('a link on %s, copied from %s: %s', (origin, page, isSendable) => {
    expect(isSendableOrigin(origin, page)).toBe(isSendable);
  });
});

describe('why a vendor call was refused', () => {
  it('words a role’s 403 for the action pressed', () => {
    expect(vendorRefusalOf(apiError(403), 'book')).toEqual({ kind: 'forbidden', action: 'book' });
    expect(vendorRefusalOf(apiError(403), 'newLink')).toEqual({
      kind: 'forbidden',
      action: 'newLink',
    });
  });

  it('reads the list’s 403 as no organization, since every organization role may read it', () => {
    expect(vendorRefusalOf(apiError(403, ['x'], 'FORBIDDEN'), 'list')).toEqual({
      kind: 'noOrganization',
    });
    expect(vendorRefusalOf(apiError(403, ['x'], 'FORBIDDEN'), 'add')).toEqual({
      kind: 'forbidden',
      action: 'add',
    });
    expect(vendorRefusalOf(apiError(403, ['x'], 'ORGANIZATION_ACCESS_DENIED'), 'book')).toEqual({
      kind: 'noOrganization',
    });
    expect(
      vendorRefusalOf(apiError(409, ['x'], 'ORGANIZATION_SELECTION_REQUIRED'), 'list'),
    ).toEqual({ kind: 'chooseOrganization' });
  });

  it('reads a 404 on booking as a vendor not on the list, and on a booking as gone', () => {
    expect(vendorRefusalOf(apiError(404, ['No such vendor']), 'book')).toEqual({
      kind: 'vendorGone',
      isStale: true,
    });
    expect(vendorRefusalOf(apiError(404), 'end')).toEqual({ kind: 'bookingGone', isStale: true });
  });

  it('marks the fields a 400 names, and shows any other as it came', () => {
    const fields = [{ field: 'feeMinor', code: 'INVALID', userMessage: 'x' }];
    expect(
      vendorRefusalOf(apiError(400, ['feeMinor must be…'], undefined, fields), 'book'),
    ).toEqual({ kind: 'fields', fields: ['fee'] });
    expect(
      vendorRefusalOf(apiError(400, ['email must be an email'], undefined, []), 'add'),
    ).toEqual({ kind: 'fields', fields: ['email'] });
    expect(
      vendorRefusalOf(apiError(400, ['Something else entirely'], undefined, []), 'add'),
    ).toEqual({ kind: 'other', sentence: 'Something else entirely', requestId: 'r-400' });
    expect(vendorRefusalOf(apiError(400, ['name: too short', 'phone: too long']), 'add')).toEqual({
      kind: 'fields',
      fields: ['name', 'phone'],
    });
    const named = [
      { field: 'briefScopes', code: 'INVALID', userMessage: 'x' },
      { field: 'status', code: 'INVALID', userMessage: 'x' },
    ];
    expect(vendorRefusalOf(apiError(400, ['x'], undefined, named), 'change')).toEqual({
      kind: 'fields',
      fields: ['scopes', 'status'],
    });
  });

  it('words too many requests and no answer', () => {
    expect(vendorRefusalOf(apiError(429), 'change')).toEqual({ kind: 'rateLimited' });
    expect(vendorRefusalOf(networkError('r-0'), 'change')).toEqual({
      kind: 'noAnswer',
      requestId: 'r-0',
    });
    expect(vendorRefusalOf(apiError(502), 'change')).toEqual({
      kind: 'noAnswer',
      requestId: 'r-502',
    });
  });

  it('throws on anything that is not the API’s, as a bug', () => {
    expect(() => vendorRefusalOf(new TypeError('boom'), 'list')).toThrow('boom');
  });
});

describe('a vendor’s address', () => {
  const vendor = (email: string) =>
    vendorFormSchema.safeParse({
      name: 'Flowers',
      category: VENDOR_CATEGORIES[0],
      email,
      phone: '',
    });

  it.each(['', ...ADDRESSES_THE_BACKEND_TAKES])('leaves “%s” to the backend', (email) => {
    expect(vendor(email).success).toBe(true);
  });

  it.each(ADDRESSES_NOBODY_TAKES)('refuses %s, saying so', (email) => {
    expect(vendor(email).error?.issues[0]?.message).toBe('email');
  });
});
