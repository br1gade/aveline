import { describe, expect, it } from 'vitest';

import type { Guest, Household } from '@/features/guests';

import { householdsToSeat } from './candidates';
import type { Arrangement, SeatingTable } from './types';

function guest(id: string, overrides: Partial<Guest> = {}): Guest {
  return {
    id,
    firstName: id,
    lastName: null,
    name: `Guest ${id}`,
    locale: null,
    side: 'UNKNOWN',
    isPrimary: false,
    isAddedByGuest: false,
    isErased: false,
    answer: 'ATTENDING',
    table: null,
    seats: [],
    releases: [],
    venueAnswers: [],
    isAskedAgain: false,
    isCheckedIn: false,
    contact: { isShown: false },
    ...overrides,
  };
}

function household(id: string, guests: Guest[]): Household {
  return {
    id,
    name: `Household ${id}`,
    seatsAllotted: guests.length,
    seatsNamed: guests.length,
    guests,
  };
}

function table(id: string, guestIds: string[], arrangementId = 'a-hall'): SeatingTable {
  return {
    id,
    arrangementId,
    name: id,
    capacity: 10,
    zone: null,
    guests: guestIds.map((guestId) => ({
      guestId,
      name: guestId,
      position: null,
      isReservation: false,
    })),
    released: [],
  };
}

const HALL: Arrangement = {
  id: 'a-hall',
  venueId: 'hall',
  venueName: 'Hall',
  venueCapacity: null,
  revision: 1,
  tableCount: 1,
};
const UNSPECIFIED: Arrangement = { ...HALL, id: 'a-none', venueId: null, venueName: null };

const atHall = (answer: Guest['answer']) => [{ venueId: 'hall', venue: 'Hall', answer }];

describe('who is coming and has no seat in this plan, the set automatic seating uses', () => {
  it('in EVENT_WIDE, everyone coming, by household in the list’s order, without anyone seated here', () => {
    const households = [
      household('h1', [guest('g1'), guest('g2', { answer: 'DECLINED' }), guest('g3')]),
      household('h2', [guest('g4', { answer: 'UNDECIDED' }), guest('g5', { answer: 'PENDING' })]),
      household('h3', [guest('g6')]),
    ];
    const result = householdsToSeat(households, HALL, 'EVENT_WIDE', [table('t1', ['g3'])]);
    expect(result.map((each) => [each.id, each.guests.map((person) => person.id)])).toEqual([
      ['h1', ['g1']],
      ['h3', ['g6']],
    ]);
  });

  it('in PER_VENUE, only those coming to this venue', () => {
    const households = [
      household('h1', [
        guest('g1', { venueAnswers: atHall('ATTENDING') }),
        guest('g2', { venueAnswers: atHall('DECLINED') }),
        guest('g3', {
          venueAnswers: [{ venueId: 'church', venue: 'Church', answer: 'ATTENDING' }],
        }),
        guest('g4', { venueAnswers: atHall('PENDING'), isAskedAgain: true }),
      ]),
    ];
    const result = householdsToSeat(households, HALL, 'PER_VENUE', []);
    expect(result.map((each) => each.guests.map((person) => person.id))).toEqual([['g1']]);
  });

  it('in PER_VENUE, nobody for the plan without a venue, as the backend has it', () => {
    const households = [household('h1', [guest('g1', { venueAnswers: atHall('ATTENDING') })])];
    expect(householdsToSeat(households, UNSPECIFIED, 'PER_VENUE', [])).toEqual([]);
    expect(householdsToSeat(households, UNSPECIFIED, 'EVENT_WIDE', [])).toHaveLength(1);
  });

  it('still offers someone seated at another venue’s plan', () => {
    const households = [household('h1', [guest('g1')])];
    const elsewhere = table('t9', ['g1'], 'a-church');
    expect(householdsToSeat(households, HALL, 'EVENT_WIDE', [elsewhere])).toHaveLength(1);
  });

  it('names the tables in this plan where the household already sits, so it stays together', () => {
    const households = [household('h1', [guest('g1'), guest('g2'), guest('g3')])];
    const tables = [
      table('t1', []),
      table('t2', ['g2']),
      table('t3', ['g3']),
      table('t9', ['g1'], 'a-church'),
    ];
    const [result] = householdsToSeat(households, HALL, 'EVENT_WIDE', tables);
    expect(result?.guests.map((person) => person.id)).toEqual(['g1']);
    expect(result?.homeTableIds).toEqual(['t2', 't3']);
  });

  it('counts a held seat as a seat', () => {
    const households = [household('h1', [guest('g1')])];
    const held = table('t1', []);
    held.guests.push({ guestId: 'g1', name: 'g1', position: null, isReservation: true });
    expect(householdsToSeat(households, HALL, 'EVENT_WIDE', [held])).toEqual([]);
  });
});
