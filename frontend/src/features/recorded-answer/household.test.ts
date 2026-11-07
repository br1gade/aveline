import { describe, expect, it } from 'vitest';

import { answerFormValues } from './form-model';
import { householdRecords, isMemberChanged } from './household';
import { readAnsweringGuest } from './read';
import { ASKING, wire } from './test-data';

const armen = readAnsweringGuest(wire());
const lusine = readAnsweringGuest(
  wire({
    id: 'g2',
    name: 'Lusine Petrosyan',
    attendance: { mode: 'EVENT_WIDE', revision: 4, status: 'PENDING', venues: [] },
    rsvpStatus: 'PENDING',
    rsvp: {
      status: 'PENDING',
      dietary: [],
      dietaryNotes: null,
      drinkPreference: null,
      songRequest: null,
      message: null,
    },
    answers: [],
  }),
);
const edit = (guest: typeof armen, changes = {}) => {
  const initial = answerFormValues(guest, ASKING);
  return { guest, initial, values: { ...initial, ...changes } };
};

describe('a household’s answers', () => {
  it('counts a member as changed only by what the backend would record', () => {
    expect(isMemberChanged(ASKING, edit(armen))).toBe(false);
    expect(isMemberChanged(ASKING, edit(armen, { status: 'DECLINED' }))).toBe(true);
    // The same choices in another order are no change.
    const both = edit(armen, { dietary: ['halal', 'vegetarian'] });
    const reordered = { ...both.values, dietary: ['vegetarian', 'halal'] };
    expect(isMemberChanged(ASKING, { ...both, initial: reordered })).toBe(false);
  });

  it('records only the members who changed, each with their own revision, in the household’s order', () => {
    const records = householdRecords(
      ASKING,
      [edit(armen), edit(lusine, { status: 'ATTENDING' })],
      false,
    );
    expect(records).toEqual([
      { guest: lusine, body: { attendanceRevision: 4, status: 'ATTENDING' } },
    ]);
  });

  it('leaves an unanswered member untouched rather than asking for an answer', () => {
    expect(householdRecords(ASKING, [edit(lusine)], false)).toEqual([]);
  });

  it('tells each member recorded when the host asks, and nobody unchanged', () => {
    const records = householdRecords(
      ASKING,
      [edit(armen, { status: 'DECLINED' }), edit(lusine)],
      true,
    );
    expect(records.map(({ guest, body }) => [guest.id, body.notifyGuest])).toEqual([['g1', true]]);
  });
});
