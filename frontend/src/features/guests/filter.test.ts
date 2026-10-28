import { describe, expect, it } from 'vitest';

import type { DeliveryGroup } from '@/features/sending';

import {
  filterFromQuery,
  filterHouseholds,
  indexHouseholds,
  normalizeName,
  withFilter,
} from './filter';
import { readHouseholds } from './read';
import { guestWire, householdWire } from './test-data';

const households = readHouseholds([
  householdWire({
    id: 'h1',
    name: 'Petrosyan family',
    guests: [
      guestWire({ id: 'g1', name: 'Armen Petrosyan', rsvpStatus: 'ATTENDING' }),
      guestWire({ id: 'g2', name: 'Ani Petrosyan', rsvpStatus: 'PENDING', isPrimary: false }),
    ],
  }),
  householdWire({
    id: 'h2',
    name: 'Семья Фёдоровых',
    guests: [guestWire({ id: 'g3', name: 'Пётр Фёдоров', rsvpStatus: 'DECLINED' })],
  }),
  householdWire({
    id: 'h3',
    name: 'Hakobyan',
    guests: [guestWire({ id: 'g4', name: 'Անի Հակոբյան', rsvpStatus: 'PENDING' })],
  }),
]);
const index = indexHouseholds(households);

const ids = (visible: ReturnType<typeof filterHouseholds>) =>
  visible.map(({ household, guests }) => [household.id, guests.map((guest) => guest.id)]);

describe('normalizeName', () => {
  it('ignores case and accents, in every script', () => {
    expect(normalizeName('Пётр')).toBe(normalizeName('петр'));
    expect(normalizeName('Ánna')).toBe('anna');
    expect(normalizeName('ԱՆԻ')).toBe(normalizeName('անի'));
  });
});

describe('filterHouseholds', () => {
  it('shows everything, as the very same objects, when nothing is filtered', () => {
    const visible = filterHouseholds(index, { query: '', answer: null, invite: null });
    expect(visible.map(({ household }) => household)).toEqual(households);
    expect(visible[0]?.guests).toBe(households[0]?.guests);
  });

  it('finds a guest by part of their name, and shows only them', () => {
    expect(ids(filterHouseholds(index, { query: 'ani', answer: null, invite: null }))).toEqual([
      ['h1', ['g2']],
    ]);
  });

  it('finds Cyrillic and Armenian names without minding ё or capitals', () => {
    expect(ids(filterHouseholds(index, { query: 'петр', answer: null, invite: null }))).toEqual([
      ['h2', ['g3']],
    ]);
    expect(ids(filterHouseholds(index, { query: 'ԱՆԻ', answer: null, invite: null }))).toEqual([
      ['h3', ['g4']],
    ]);
  });

  it('shows a whole household whose name matches', () => {
    const visible = filterHouseholds(index, { query: 'petrosyan fam', answer: null, invite: null });
    expect(ids(visible)).toEqual([['h1', ['g1', 'g2']]]);
    expect(visible[0]?.guests).toBe(households[0]?.guests);
  });

  it('filters by answer, and by both at once', () => {
    expect(ids(filterHouseholds(index, { query: '', answer: 'PENDING', invite: null }))).toEqual([
      ['h1', ['g2']],
      ['h3', ['g4']],
    ]);
    expect(
      ids(filterHouseholds(index, { query: 'petrosyan', answer: 'ATTENDING', invite: null })),
    ).toEqual([['h1', ['g1']]]);
  });

  it('shows nothing when nothing matches', () => {
    expect(filterHouseholds(index, { query: 'zzz', answer: null, invite: null })).toEqual([]);
  });

  it('filters by what happened to the invitation, with the search and the answer', () => {
    const groups: Record<string, DeliveryGroup> = { h1: 'attention', h2: 'sent' };
    const groupOf = (householdId: string) => groups[householdId] ?? null;
    const attention = { query: '', answer: null, invite: 'attention' } as const;
    expect(ids(filterHouseholds(index, attention, groupOf))).toEqual([['h1', ['g1', 'g2']]]);
    expect(
      ids(filterHouseholds(index, { ...attention, query: 'armen', answer: 'ATTENDING' }, groupOf)),
    ).toEqual([['h1', ['g1']]]);
    // A household the report does not mention is in no group.
    expect(ids(filterHouseholds(index, { ...attention, invite: 'notSent' }, groupOf))).toEqual([]);
  });

  it('ignores the invitation filter when there is no report to read it from', () => {
    const visible = filterHouseholds(index, { query: '', answer: null, invite: 'attention' });
    expect(visible).toHaveLength(3);
  });

  it('trims the search', () => {
    expect(ids(filterHouseholds(index, { query: '  ani  ', answer: null, invite: null }))).toEqual([
      ['h1', ['g2']],
    ]);
  });
});

describe('the filter in the address', () => {
  it('reads the search and the answer', () => {
    expect(filterFromQuery(new URLSearchParams('q=Ani&answer=pending'))).toEqual({
      query: 'Ani',
      answer: 'PENDING',
      invite: null,
    });
  });

  it('ignores an answer it does not know, and a missing one', () => {
    expect(filterFromQuery(new URLSearchParams('answer=maybe&invite=lost'))).toEqual({
      query: '',
      answer: null,
      invite: null,
    });
    expect(filterFromQuery(new URLSearchParams(''))).toEqual({
      query: '',
      answer: null,
      invite: null,
    });
  });

  it('reads and writes the invitation filter', () => {
    expect(filterFromQuery(new URLSearchParams('invite=attention')).invite).toBe('attention');
    const written = withFilter(new URLSearchParams('q=Ani'), {
      query: 'Ani',
      answer: null,
      invite: 'notSent',
    });
    expect(written.toString()).toBe('q=Ani&invite=notSent');
    expect(withFilter(written, { query: 'Ani', answer: null, invite: null }).toString()).toBe(
      'q=Ani',
    );
  });

  it('writes the filter, keeps the rest of the query, and drops what is empty', () => {
    const query = withFilter(new URLSearchParams('lang=hy&answer=declined'), {
      query: 'Ani',
      answer: 'ATTENDING',
      invite: null,
    });
    expect(query.toString()).toBe('lang=hy&answer=attending&q=Ani');
    expect(withFilter(query, { query: ' ', answer: null, invite: null }).toString()).toBe(
      'lang=hy',
    );
  });
});
