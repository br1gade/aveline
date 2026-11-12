import { describe, expect, it } from 'vitest';

import { readRoster } from './read';

const ROW = {
  guestId: 'g1',
  name: 'Armen Petrosyan',
  householdName: 'Petrosyan family',
  attendance: 'ATTENDING' as const,
  arrivedAt: null,
  hasTicket: true,
  isErased: false,
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

  it('takes who was erased from the roster, not from their name (FR-141)', () => {
    const erased = { ...ROW, name: 'Armen Petrosyan', isErased: true };
    const namedLikeThePlaceholder = { ...ROW, guestId: 'g2', name: 'Removed' };
    const { guests } = readRoster({ items: [erased, namedLikeThePlaceholder], nextCursor: null });
    expect(guests.map((guest) => guest.isErased)).toEqual([true, false]);
  });
});
