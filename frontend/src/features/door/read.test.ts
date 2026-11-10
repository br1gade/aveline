import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readRoster } from './read';

const ROW = {
  guestId: 'g1',
  name: 'Armen Petrosyan',
  householdName: 'Petrosyan family',
  attendance: 'ATTENDING' as const,
  arrivedAt: null,
  hasTicket: true,
  seating: [{ venue: null, table: 'Table 4', position: 2 }],
};

describe('reading the door roster (FR-79)', () => {
  it('keeps each field the door shows, and nothing else a row carries', () => {
    const planted = { ...ROW, token: 'tok-planted', email: 'planted@example.am' };
    expect(readRoster({ items: [planted], nextCursor: 'g1' })).toEqual({
      guests: [
        {
          id: 'g1',
          name: 'Armen Petrosyan',
          householdName: 'Petrosyan family',
          answer: 'ATTENDING',
          arrivedAt: null,
          seats: [{ table: 'Table 4', venue: null }],
          isErased: false,
        },
      ],
      nextCursor: 'g1',
    });
  });

  it('reads an answer it doesn’t know as none yet', () => {
    const odd = { ...ROW, attendance: 'SOMETHING_NEW' as unknown as 'PENDING' };
    expect(readRoster({ items: [odd], nextCursor: null }).guests[0]?.answer).toBe('PENDING');
  });

  it('tells someone erased by the backend’s placeholder, a stand-in until FR-141', () => {
    const erased = { ...ROW, name: 'Removed' };
    expect(readRoster({ items: [erased], nextCursor: null }).guests[0]?.isErased).toBe(true);
    const anonymisation = readFileSync(
      join(import.meta.dirname, '../../../../backend/src/modules/privacy/anonymisation.ts'),
      'utf8',
    );
    expect(anonymisation).toContain("export const ERASED_NAME = 'Removed';");
    expect(anonymisation).toMatch(/firstName: ERASED_NAME,\s+lastName: null,/);
  });
});
