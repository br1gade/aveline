import { describe, expect, it } from 'vitest';

import { NEW_HOUSEHOLD } from './form-model';
import {
  guestFormSchema,
  householdFormSchema,
  importFormSchema,
  MAX_IMPORT_BYTES,
} from './schemas';

const filled = {
  firstName: 'Ani',
  lastName: '',
  email: '',
  phone: '',
  locale: '',
  side: 'UNKNOWN',
  household: NEW_HOUSEHOLD,
  seats: '1',
} as const;

function codes(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return result.success
    ? []
    : (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]);
}

describe('guestFormSchema', () => {
  it('trims what was typed, and reads the seats as a number', () => {
    const result = guestFormSchema.parse({
      ...filled,
      firstName: '  Ani ',
      lastName: ' Hakobyan ',
      seats: '4',
    });
    expect(result).toMatchObject({ firstName: 'Ani', lastName: 'Hakobyan', seats: 4 });
  });

  it('asks for a first name, and keeps the backend’s lengths', () => {
    expect(codes(guestFormSchema.safeParse({ ...filled, firstName: '   ' }))).toEqual([
      ['firstName', 'required'],
    ]);
    expect(codes(guestFormSchema.safeParse({ ...filled, firstName: 'a'.repeat(81) }))).toEqual([
      ['firstName', 'tooLong'],
    ]);
    expect(guestFormSchema.safeParse({ ...filled, firstName: 'a'.repeat(80) }).success).toBe(true);
    expect(
      codes(guestFormSchema.safeParse({ ...filled, email: `${'a'.repeat(316)}@b.am` })),
    ).toEqual([['email', 'tooLong']]);
    expect(codes(guestFormSchema.safeParse({ ...filled, phone: '1'.repeat(41) }))).toEqual([
      ['phone', 'tooLong'],
    ]);
  });

  it.each([
    ['0', false],
    ['1', true],
    ['20', true],
    ['21', false],
    ['2.5', false],
    ['', false],
  ])('a new household of %s seats is accepted: %s', (seats, isAccepted) => {
    const result = guestFormSchema.safeParse({ ...filled, seats });
    expect(result.success).toBe(isAccepted);
    if (!isAccepted) expect(codes(result)).toEqual([['seats', 'seats']]);
  });

  it('does not check the seats of a household the guest joins', () => {
    expect(guestFormSchema.safeParse({ ...filled, household: 'h1', seats: '' }).success).toBe(true);
  });
});

describe('householdFormSchema', () => {
  it('keeps the seats at or above the guests already named, and at most 20', () => {
    const schema = householdFormSchema(3);
    expect(codes(schema.safeParse({ name: 'Petrosyan family', seats: '2' }))).toEqual([
      ['seats', 'seatsBelowNamed'],
    ]);
    expect(schema.safeParse({ name: 'Petrosyan family', seats: '3' }).success).toBe(true);
    expect(codes(schema.safeParse({ name: 'Petrosyan family', seats: '21' }))).toEqual([
      ['seats', 'seats'],
    ]);
  });

  it('never goes below one seat, even with nobody named', () => {
    expect(
      codes(householdFormSchema(0).safeParse({ name: 'Petrosyan family', seats: '0' })),
    ).toEqual([['seats', 'seats']]);
  });

  it('asks for a name of at most 120 characters', () => {
    const schema = householdFormSchema(1);
    expect(codes(schema.safeParse({ name: ' ', seats: '1' }))).toEqual([['name', 'required']]);
    expect(codes(schema.safeParse({ name: 'a'.repeat(121), seats: '1' }))).toEqual([
      ['name', 'tooLong'],
    ]);
  });
});

describe('importFormSchema', () => {
  const file = (size: number) => [{ name: 'guests.csv', size }] as unknown as FileList;

  it('asks for a file', () => {
    expect(codes(importFormSchema.safeParse({ files: [] as unknown as FileList }))).toEqual([
      ['files', 'required'],
    ]);
  });

  it('refuses a file over 2 MB before it is sent, and takes one of exactly 2 MB', () => {
    expect(codes(importFormSchema.safeParse({ files: file(MAX_IMPORT_BYTES + 1) }))).toEqual([
      ['files', 'tooLarge'],
    ]);
    expect(importFormSchema.safeParse({ files: file(MAX_IMPORT_BYTES) }).success).toBe(true);
  });
});
