import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { hallRefusalOf, hallsByCity } from './directory';
import { createVenuePayload, hallUpdatePayload, newHallPayload } from './payload';
import { readDirectory, readHallOperators } from './read';
import { hallFormSchema, type HallFormValues } from './schemas';
import type { DirectoryHallWire, VendorWire } from './types';

const refused = (status: number, message: string) =>
  new ApiError({ status, messages: [message], requestId: `r-${status}` });

function hallWire(overrides: Partial<DirectoryHallWire> = {}): DirectoryHallWire {
  return {
    id: 'p1',
    name: 'Grand Hall',
    address: '1 Abovyan Street',
    city: 'Yerevan',
    capacity: 300,
    vendor: { id: 'v1', name: 'Hall Group' },
    ...overrides,
  };
}

describe('the directory, as read', () => {
  it('keeps each hall and its operator’s name', () => {
    expect(readDirectory([hallWire()])).toEqual([
      {
        id: 'p1',
        name: 'Grand Hall',
        address: '1 Abovyan Street',
        city: 'Yerevan',
        capacity: 300,
        operatorId: 'v1',
        operatorName: 'Hall Group',
      },
    ]);
  });

  it('reads a hall whose operator is no longer eligible as having none', () => {
    const [hall] = readDirectory([hallWire({ vendor: null })]);
    expect(hall).toMatchObject({ operatorId: null, operatorName: null });
  });

  it('drops anything else', () => {
    const secret = crypto.randomUUID();
    const wire = { ...hallWire(), notes: secret } as unknown as DirectoryHallWire;
    expect(JSON.stringify(readDirectory([wire]))).not.toContain(secret);
  });
});

describe('who can operate a hall', () => {
  const vendor = (overrides: Partial<VendorWire>): VendorWire => ({
    id: 'v1',
    name: 'Hall Group',
    category: 'VENUE',
    isCurated: true,
    ...overrides,
  });

  it('is only a curated venue vendor, the one kind the backend accepts', () => {
    const operators = readHallOperators([
      vendor({}),
      vendor({ id: 'private', isCurated: false }),
      vendor({ id: 'caterer', category: 'CATERING' }),
    ]);
    expect(operators).toEqual([{ id: 'v1', name: 'Hall Group' }]);
  });

  it('never keeps a vendor’s contact details', () => {
    const wire = { ...vendor({}), email: 'a@example.am', phone: '+374' } as VendorWire;
    expect(JSON.stringify(readHallOperators([wire]))).not.toContain('example.am');
  });
});

describe('halls by city', () => {
  it('keeps the API’s order, with halls of no city as their own group', () => {
    const halls = readDirectory([
      hallWire({ id: 'a', city: 'Dilijan' }),
      hallWire({ id: 'b', city: 'Yerevan' }),
      hallWire({ id: 'c', city: 'Yerevan' }),
      hallWire({ id: 'd', city: null }),
    ]);
    expect(
      hallsByCity(halls).map(({ city, halls: inCity }) => [city, inCity.map((hall) => hall.id)]),
    ).toEqual([
      ['Dilijan', ['a']],
      ['Yerevan', ['b', 'c']],
      [null, ['d']],
    ]);
  });
});

describe('adding a venue from the directory', () => {
  const values = {
    role: 'RECEPTION' as const,
    name: 'Grand Hall',
    address: '1 Abovyan Street',
    mapUrl: '',
    arrivalDate: '',
    arrivalTime: '',
  };

  it('names the hall, whose coordinates and capacity the server copies', () => {
    expect(createVenuePayload(values, 'Asia/Yerevan', 'p1')).toEqual({
      role: 'RECEPTION',
      name: 'Grand Hall',
      address: '1 Abovyan Street',
      profileId: 'p1',
    });
  });

  it('names no hall when none was chosen', () => {
    expect(createVenuePayload(values, 'Asia/Yerevan')).not.toHaveProperty('profileId');
  });
});

const HALL: HallFormValues = {
  name: 'Grand Hall',
  address: '1 Abovyan Street',
  city: 'Yerevan',
  capacity: '300',
  operatorId: 'v1',
};

describe('a hall’s payloads', () => {
  it('sends only what was filled in for a new one', () => {
    expect(newHallPayload({ ...HALL, city: '', capacity: '', operatorId: '' })).toEqual({
      name: 'Grand Hall',
      address: '1 Abovyan Street',
    });
    expect(newHallPayload(HALL)).toEqual({
      name: 'Grand Hall',
      address: '1 Abovyan Street',
      city: 'Yerevan',
      capacity: 300,
      vendorId: 'v1',
    });
  });

  it('sends only what changed in a correction', () => {
    expect(hallUpdatePayload(HALL, HALL)).toEqual({});
    expect(hallUpdatePayload(HALL, { ...HALL, name: 'Great Hall', capacity: '250' })).toEqual({
      name: 'Great Hall',
      capacity: 250,
    });
  });

  it('sends a new city and address', () => {
    expect(hallUpdatePayload(HALL, { ...HALL, city: 'Dilijan', address: '2 Street' })).toEqual({
      address: '2 Street',
      city: 'Dilijan',
    });
  });

  it('links another operator, and unlinks with null', () => {
    expect(hallUpdatePayload(HALL, { ...HALL, operatorId: 'v2' })).toEqual({ vendorId: 'v2' });
    expect(hallUpdatePayload(HALL, { ...HALL, operatorId: '' })).toEqual({ vendorId: null });
  });
});

const BLANK: HallFormValues = { name: '', address: '', city: '', capacity: '', operatorId: '' };

describe('a hall’s checks', () => {
  const issue = (values: HallFormValues, initial: HallFormValues = BLANK) =>
    hallFormSchema(initial).safeParse(values).error?.issues[0];

  it.each([
    [{ name: '  ' }, 'name', 'required'],
    [{ name: 'x'.repeat(161) }, 'name', 'tooLong'],
    [{ address: '' }, 'address', 'required'],
    [{ address: 'x'.repeat(301) }, 'address', 'tooLong'],
    [{ city: 'x'.repeat(81) }, 'city', 'tooLong'],
    [{ capacity: '0' }, 'capacity', 'capacity'],
    [{ capacity: '100001' }, 'capacity', 'capacity'],
    [{ capacity: '12.5' }, 'capacity', 'capacity'],
  ])('refuses %o', (change, field, code) => {
    expect(issue({ ...HALL, ...change })).toMatchObject({ path: [field], message: code });
  });

  it.each([
    [{ name: 'x'.repeat(160) }],
    [{ address: 'x'.repeat(300) }],
    [{ city: 'x'.repeat(80) }],
  ])('takes %o, at its limit', (change) => {
    expect(issue({ ...HALL, ...change })).toBeUndefined();
  });

  it.each(['1', '100000', ''])('takes a capacity of “%s”', (capacity) => {
    expect(issue({ ...HALL, capacity })).toBeUndefined();
  });

  it.each(['city', 'capacity'] as const)(
    'refuses emptying a %s once set, which the API’s types can’t clear (FR-91)',
    (field) => {
      expect(issue({ ...HALL, [field]: '' }, HALL)).toMatchObject({
        path: [field],
        message: 'cantClear',
      });
      expect(issue({ ...HALL, [field]: '' })).toBeUndefined();
    },
  );

  it.each(['city', 'capacity'] as const)(
    'lets a hall with no %s be corrected without giving it one',
    (field) => {
      const none = { ...HALL, [field]: '' };
      expect(issue(none, none)).toBeUndefined();
    },
  );
});

describe('a directory write refused', () => {
  it.each([
    [refused(403, 'Forbidden'), 'staffOnly'],
    [refused(404, 'No such venue in the directory'), 'gone'],
    [refused(400, 'vendorId: choose an active curated VENUE vendor'), 'operatorRefused'],
    [refused(429, 'Too many'), 'rateLimited'],
    [refused(500, 'Oops'), 'noAnswer'],
    [networkError(), 'noAnswer'],
  ])('reads %s', (error, kind) => {
    expect(hallRefusalOf(error).kind).toBe(kind);
  });

  it('reloads the list behind what shows it out of date', () => {
    expect(hallRefusalOf(refused(404, 'x')).isStale).toBe(true);
    expect(
      hallRefusalOf(refused(400, 'vendorId: choose an active curated VENUE vendor')).isStale,
    ).toBe(true);
    expect(hallRefusalOf(refused(403, 'x')).isStale).toBeUndefined();
  });

  it('shows anything else as it came', () => {
    expect(hallRefusalOf(refused(400, 'name must be a string'))).toEqual({
      kind: 'other',
      sentence: 'name must be a string',
      requestId: 'r-400',
    });
  });

  it('throws on a failure that isn’t the API’s: a bug must not read as “no answer”', () => {
    expect(() => hallRefusalOf(new TypeError('a bug'))).toThrow('a bug');
  });

  it('matches the backend’s sentences', () => {
    const source = join(process.cwd(), '..', 'backend', 'src', 'modules', 'design');
    const service = readFileSync(join(source, 'venues.service.ts'), 'utf8');
    expect(service).toContain('vendorId: choose an active curated VENUE vendor');
    expect(service).toContain('No such venue in the directory');
  });
});
