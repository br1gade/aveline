import { describe, expect, it } from 'vitest';

import { findGuests, indexGuests, MAX_FOUND } from './search';
import { doorGuest, doorHousehold } from './test-data';

const names = (found: ReturnType<typeof findGuests>) => found.people.map(({ guest }) => guest.name);

const PETROSYANS = doorHousehold('h1', 'Petrosyan family', [
  doorGuest('g1', 'Armen Petrosyan'),
  doorGuest('g2', 'Lusine Petrosyan'),
]);
const AGHAJANYAN = doorHousehold('h2', 'Aghajanyan', [doorGuest('g3', 'Karen Aghajanyan')]);
const LEVON = doorHousehold('h3', 'Friends of Armen', [doorGuest('g4', 'Levon Sahakyan')]);
const INDEX = indexGuests([AGHAJANYAN, LEVON, PETROSYANS]);

describe('finding someone at the door by name', () => {
  it.each(['', '   '])('shows nobody for %j, so the whole list is never on screen', (query) => {
    expect(findGuests(INDEX, query)).toEqual({ people: [], isCapped: false });
  });

  it('finds a person, then the rest of their household, who usually arrive with them', () => {
    expect(names(findGuests(INDEX, 'lusine'))).toEqual(['Lusine Petrosyan', 'Armen Petrosyan']);
    expect(findGuests(INDEX, 'lusine').people.map(({ isMatch }) => isMatch)).toEqual([true, false]);
  });

  it('matches every word typed, in any order', () => {
    expect(names(findGuests(INDEX, 'petrosyan armen'))[0]).toBe('Armen Petrosyan');
    expect(names(findGuests(INDEX, 'armen karen'))).toEqual([]);
  });

  it('puts a person’s own name before a match on a household’s name', () => {
    expect(names(findGuests(INDEX, 'armen'))).toEqual([
      'Armen Petrosyan',
      'Lusine Petrosyan',
      'Levon Sahakyan',
    ]);
  });

  it('ignores case and accents, in every script', () => {
    const index = indexGuests([
      doorHousehold('h1', 'Семья', [doorGuest('g1', 'Пётр Иванов')]),
      doorHousehold('h2', 'Գևորգյան', [doorGuest('g2', 'Անի Գևորգյան')]),
    ]);
    expect(names(findGuests(index, 'ПЕТР'))).toEqual(['Пётр Иванов']);
    expect(names(findGuests(index, 'անի'))).toEqual(['Անի Գևորգյան']);
  });

  it('never offers someone erased at their request', () => {
    const index = indexGuests([
      doorHousehold('h1', 'Petrosyan family', [
        doorGuest('g1', 'Armen Petrosyan'),
        doorGuest('g2', 'Erased guest', { isErased: true }),
      ]),
    ]);
    expect(names(findGuests(index, 'petrosyan'))).toEqual(['Armen Petrosyan']);
    expect(names(findGuests(index, 'erased'))).toEqual([]);
  });

  it('stops at its limit and says so, and exactly the limit is not capped', () => {
    const guestsOf = (count: number) =>
      Array.from({ length: count }, (_, at) =>
        doorHousehold(`h${at}`, `Household ${at}`, [doorGuest(`g${at}`, `Ani ${at}`)]),
      );
    const exact = findGuests(indexGuests(guestsOf(MAX_FOUND)), 'ani');
    expect(exact.people).toHaveLength(MAX_FOUND);
    expect(exact.isCapped).toBe(false);
    const over = findGuests(indexGuests(guestsOf(MAX_FOUND + 1)), 'ani');
    expect(over.people).toHaveLength(MAX_FOUND);
    expect(over.isCapped).toBe(true);
  });
});
