import { describe, expect, it } from 'vitest';

import { blankPerson, rosterFor } from './roster';

function named(ticketTypeId: string, firstName: string) {
  return { ...blankPerson(ticketTypeId), firstName };
}

describe('the roster: one named person per ticket', () => {
  it("makes one person per ticket, in the basket's order, each with their ticket's type", () => {
    const roster = rosterFor([
      { ticketTypeId: 'general', quantity: 2 },
      { ticketTypeId: 'table', quantity: 1 },
    ]);
    expect(roster.map((person) => person.ticketTypeId)).toEqual(['general', 'general', 'table']);
    expect(roster.every((person) => person.firstName === '' && !person.isBuyer)).toBe(true);
  });

  it('keeps the people already typed, by their place within their type', () => {
    const before = [named('general', 'Anna'), named('general', 'Davit'), named('table', 'Ani')];
    const after = rosterFor(
      [
        { ticketTypeId: 'table', quantity: 2 },
        { ticketTypeId: 'general', quantity: 1 },
      ],
      before,
    );
    expect(after.map((person) => [person.ticketTypeId, person.firstName])).toEqual([
      ['table', 'Ani'],
      ['table', ''],
      ['general', 'Anna'],
    ]);
  });

  it('counts exactly what each line asks for', () => {
    const roster = rosterFor([
      { ticketTypeId: 'a', quantity: 3 },
      { ticketTypeId: 'b', quantity: 100 },
    ]);
    expect(roster.filter((person) => person.ticketTypeId === 'a')).toHaveLength(3);
    expect(roster.filter((person) => person.ticketTypeId === 'b')).toHaveLength(100);
  });

  it('is empty for an empty basket', () => {
    expect(rosterFor([])).toEqual([]);
  });
});
