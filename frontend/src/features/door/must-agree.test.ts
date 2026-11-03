import { describe, expect, it } from 'vitest';

import type { Question } from '@/features/invitation-design';

import {
  agreementsFrom,
  mergeNewest,
  peopleWhoMustAgree,
  requiredStatements,
  statementsStillOwed,
  statementWords,
} from './must-agree';
import { doorGuest, doorHousehold } from './test-data';

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-rules',
    type: 'SIGNATURE',
    required: true,
    prompt: { en: 'I accept the rules', ru: 'Я принимаю правила' },
    options: {},
    answerCount: 0,
    statementVersionId: 'v2',
    ...overrides,
  };
}

const record = (subjectGuestId: string, statementVersionId = 'v2') => ({
  subjectGuestId,
  statementVersionId,
});

describe('what the door requires', () => {
  it('is the required SIGNATURE questions, each in its current wording', () => {
    const statements = requiredStatements([
      question(),
      question({ id: 'q-optional', required: false }),
      question({ id: 'q-meal', type: 'TEXT' }),
      question({ id: 'q-unworded', statementVersionId: null }),
    ]);
    expect(statements.map(({ questionId, versionId }) => [questionId, versionId])).toEqual([
      ['q-rules', 'v2'],
    ]);
  });

  it('words a statement in the page’s language, then the event’s, then any', () => {
    const [statement] = requiredStatements([question()]);
    if (!statement) throw new Error('No statement');
    expect(statementWords(statement, 'ru', 'en')).toBe('Я принимаю правила');
    expect(statementWords(statement, 'hy', 'en')).toBe('I accept the rules');
    expect(statementWords(statement, 'hy', 'fr')).toBe('I accept the rules');
  });
});

describe('who still owes a statement', () => {
  const statements = requiredStatements([question()]);

  it('owes nothing with a record of the current wording', () => {
    expect(statementsStillOwed('g1', statements, agreementsFrom([record('g1')]))).toEqual([]);
  });

  it('owes it again after agreeing only to an earlier wording', () => {
    const owed = statementsStillOwed('g1', statements, agreementsFrom([record('g1', 'v1')]));
    expect(owed.map(({ questionId }) => questionId)).toEqual(['q-rules']);
  });

  it('owes it with no record at all, and a neighbour’s record does not count', () => {
    const owed = statementsStillOwed('g2', statements, agreementsFrom([record('g1')]));
    expect(owed.map(({ questionId }) => questionId)).toEqual(['q-rules']);
  });
});

describe('the list of people to tell', () => {
  const statements = requiredStatements([question()]);
  const nobodyHere = () => false;
  const households = [
    doorHousehold('h1', 'Petrosyan family', [
      doorGuest('g1', 'Armen Petrosyan'),
      doorGuest('g2', 'Agreed Already'),
      doorGuest('g3', 'Not Coming', { answer: 'DECLINED' }),
      doorGuest('g4', 'Erased', { isErased: true }),
    ]),
  ];
  const ids = (isHere: (guest: { id: string }) => boolean) =>
    peopleWhoMustAgree(households, statements, agreementsFrom([record('g2')]), isHere).map(
      ({ guest }) => guest.id,
    );

  it('is who is coming, not erased, and has not agreed', () => {
    const people = peopleWhoMustAgree(
      households,
      statements,
      agreementsFrom([record('g2')]),
      nobodyHere,
    );
    expect(people.map(({ guest }) => guest.id)).toEqual(['g1']);
    expect(people[0]?.owed.map(({ questionId }) => questionId)).toEqual(['q-rules']);
  });

  it('leaves out whoever the door says is here, whatever the list last said', () => {
    expect(ids(({ id }) => id === 'g1')).toEqual([]);
    const listedHere = [
      doorHousehold('h2', 'Undone', [doorGuest('g9', 'Undone', { isCheckedIn: true })]),
    ];
    const people = peopleWhoMustAgree(listedHere, statements, agreementsFrom([]), nobodyHere);
    expect(people.map(({ guest }) => guest.id)).toEqual(['g9']);
  });

  it('is nobody when nothing is required', () => {
    expect(peopleWhoMustAgree(households, [], agreementsFrom([]), nobodyHere)).toEqual([]);
  });
});

describe('reading the newest agreements again', () => {
  it('adds what is new to what was read, so one guest’s agreement needs one read', () => {
    const agreed = mergeNewest(agreementsFrom([record('g1')]), [record('g2')]);
    const statements = requiredStatements([question()]);
    expect(statementsStillOwed('g1', statements, agreed)).toEqual([]);
    expect(statementsStillOwed('g2', statements, agreed)).toEqual([]);
    expect(statementsStillOwed('g3', statements, agreed)).toHaveLength(1);
  });
});
