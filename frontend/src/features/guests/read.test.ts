import { describe, expect, it } from 'vitest';

import { readHouseholds, readImportHistory, readImportResult } from './read';
import { guestWire, guestWithoutContact, householdWire } from './test-data';

describe('readHouseholds', () => {
  it('never lets a guest’s token through, however it arrives', () => {
    const token = crypto.randomUUID();
    const read = readHouseholds([
      householdWire({
        guests: [guestWire({ token }), guestWire({ id: 'g2', token, isPrimary: false })],
      }),
    ]);
    expect(JSON.stringify(read)).not.toContain(token);
    for (const guest of read.flatMap((household) => household.guests)) {
      expect(guest).not.toHaveProperty('token');
    }
  });

  it('keeps only the fields it names, so a new one in the response goes no further', () => {
    const extra = { ...guestWire(), personalLink: 'https://example.test/secret' };
    const [household] = readHouseholds([householdWire({ guests: [extra] })]);
    expect(JSON.stringify(household)).not.toContain('secret');
  });

  it('reads email and phone as shown when they arrived, even empty', () => {
    const [household] = readHouseholds([
      householdWire({ guests: [guestWire({ email: null, phone: null })] }),
    ]);
    expect(household?.guests[0]?.contact).toEqual({ isShown: true, email: null, phone: null });
  });

  it('reads missing contact fields as not this caller’s to see, never as empty', () => {
    const [household] = readHouseholds([householdWire({ guests: [guestWithoutContact()] })]);
    expect(household?.guests[0]?.contact).toEqual({ isShown: false });
  });

  it('keeps the households and guests in the order they came', () => {
    const read = readHouseholds([
      householdWire({ id: 'h2', name: 'Avagyan family' }),
      householdWire({
        id: 'h1',
        guests: [guestWire({ id: 'g1' }), guestWire({ id: 'g3', isPrimary: false })],
      }),
    ]);
    expect(read.map((household) => household.id)).toEqual(['h2', 'h1']);
    expect(read[1]?.guests.map((guest) => guest.id)).toEqual(['g1', 'g3']);
  });

  it('renames what the screens read', () => {
    const [household] = readHouseholds([
      householdWire({
        guests: [
          guestWire({
            attribution: 'SHARED',
            addedByGuest: true,
            isAnonymized: true,
            rsvpStatus: 'PENDING',
            isCheckedIn: true,
          }),
        ],
      }),
    ]);
    expect(household?.guests[0]).toMatchObject({
      side: 'SHARED',
      isAddedByGuest: true,
      isErased: true,
      answer: 'PENDING',
      isCheckedIn: true,
    });
  });
});

describe('readImportResult', () => {
  it('keeps each refused row’s own spreadsheet number and the cell it quotes', () => {
    const result = readImportResult({
      importId: 'i1',
      status: 'PARTIAL',
      rowsImported: 412,
      rowsFailed: 2,
      errors: [
        { row: 7, message: 'No name in this row' },
        { row: 19, message: 'That does not look like an email address', value: 'ani@@example' },
      ],
    });
    expect(result).toEqual({
      status: 'PARTIAL',
      rowsImported: 412,
      rowsFailed: 2,
      errors: [
        { row: 7, message: 'No name in this row', value: null },
        { row: 19, message: 'That does not look like an email address', value: 'ani@@example' },
      ],
    });
  });

  it('keeps row 0, which is the file itself', () => {
    const result = readImportResult({
      importId: 'i2',
      status: 'FAILED',
      rowsImported: 0,
      rowsFailed: 1,
      errors: [{ row: 0, message: 'The file has a header but no rows' }],
    });
    expect(result.errors[0]?.row).toBe(0);
  });
});

describe('readImportHistory', () => {
  it('reads each stored import, a running one and one without errors included', () => {
    const history = readImportHistory([
      {
        id: 'i3',
        filename: 'guests.csv',
        status: 'PROCESSING',
        rowsImported: 0,
        rowsFailed: 0,
        errors: null,
        createdAt: '2026-10-24T09:00:00.000Z',
      },
      {
        id: 'i2',
        filename: 'guests (1).csv',
        status: 'PARTIAL',
        rowsImported: 3,
        rowsFailed: 1,
        errors: [
          { row: 5, message: 'Seats must be a whole number between 1 and 20', value: 'many' },
        ],
        createdAt: '2026-10-23T09:00:00.000Z',
      },
    ]);
    expect(history.map((record) => [record.id, record.status, record.errors.length])).toEqual([
      ['i3', 'PROCESSING', 0],
      ['i2', 'PARTIAL', 1],
    ]);
    expect(history[1]?.errors[0]?.value).toBe('many');
  });
});
