import { describe, expect, it } from 'vitest';

import { freeSeats, inNaturalOrder, roomFor, tablesOf, venueRoom } from './tables';
import type { Arrangement, SeatingTable } from './types';

interface Shape {
  capacity?: number;
  seated?: number;
  arrangementId?: string;
}

function table(
  id: string,
  name: string,
  { capacity = 10, seated = 0, arrangementId = 'a1' }: Shape = {},
): SeatingTable {
  return {
    id,
    arrangementId,
    name,
    capacity,
    zone: null,
    guests: Array.from({ length: seated }, (_, index) => ({
      guestId: `${id}-g${index}`,
      name: `Guest ${index}`,
      position: null,
      isReservation: false,
    })),
    released: [],
  };
}

const PLAN: Arrangement = {
  id: 'a1',
  venueId: 'hall',
  venueName: 'Hall',
  venueCapacity: null,
  revision: 3,
  tableCount: 0,
};

describe('tables in their natural order (FR-54)', () => {
  it.each(['en', 'hy', 'ru', 'fr'])('puts Table 2 before Table 10 in %s', (language) => {
    const names = inNaturalOrder(
      [
        table('t10', 'Table 10'),
        table('t2', 'Table 2'),
        table('t1', 'Table 1'),
        table('k', 'Kids'),
      ],
      language,
    ).map((each) => each.name);
    expect(names.indexOf('Table 2')).toBeLessThan(names.indexOf('Table 10'));
    expect(names.indexOf('Table 1')).toBeLessThan(names.indexOf('Table 2'));
  });

  it('orders Armenian and Cyrillic names by their numbers too', () => {
    expect(
      inNaturalOrder([table('b', 'Սեղան 12'), table('a', 'Սեղան 3')], 'hy').map((each) => each.id),
    ).toEqual(['a', 'b']);
    expect(
      inNaturalOrder([table('b', 'Стол 12'), table('a', 'Стол 3')], 'ru').map((each) => each.id),
    ).toEqual(['a', 'b']);
  });

  it('keeps only one plan’s tables', () => {
    const tables = [table('t1', 'Table 1'), table('t2', 'Table 2', { arrangementId: 'a2' })];
    expect(tablesOf(tables, 'a2', 'en').map((each) => each.id)).toEqual(['t2']);
  });
});

describe('room at a table and at the venue', () => {
  it('counts the free seats', () => {
    expect(freeSeats(table('t', 'Table 1', { seated: 7 }))).toBe(3);
    expect(freeSeats(table('t', 'Table 1', { capacity: 4, seated: 4 }))).toBe(0);
  });

  it('has no venue limit without a capacity, and never less than nothing', () => {
    const tables = [table('t1', 'Table 1', { seated: 6 }), table('t2', 'Table 2', { seated: 4 })];
    expect(venueRoom(PLAN, tables)).toBeNull();
    expect(venueRoom({ ...PLAN, venueCapacity: 12 }, tables)).toBe(2);
    expect(venueRoom({ ...PLAN, venueCapacity: 8 }, tables)).toBe(0);
  });

  it('offers the tables with room for everyone, the venue’s limit included', () => {
    const tables = [
      table('t1', 'Table 1', { seated: 8 }),
      table('t2', 'Table 2', { seated: 5 }),
      table('t3', 'Table 3', { capacity: 4 }),
    ];
    expect(roomFor(tables, 3, null).map((each) => each.id)).toEqual(['t2', 't3']);
    expect(roomFor(tables, 2, null).map((each) => each.id)).toEqual(['t1', 't2', 't3']);
    expect(roomFor(tables, 3, 2)).toEqual([]);
    expect(roomFor(tables, 2, 2).map((each) => each.id)).toEqual(['t1', 't2', 't3']);
  });
});
