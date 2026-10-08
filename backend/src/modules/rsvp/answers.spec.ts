import { QuestionType, RsvpStatus } from '@prisma/client';
import { AnswerableQuestion, answersProblem, unansweredRequired } from './answers';

const question = (type: QuestionType, extra: Partial<AnswerableQuestion> = {}): AnswerableQuestion => ({
  id: type.toLowerCase(),
  type,
  required: false,
  options: null,
  ...extra,
});

const meal = question(QuestionType.SINGLE_CHOICE, { options: { en: ['Meat', 'Fish'], hy: ['Միս', 'Ձուկ'] } });
const extras = question(QuestionType.MULTI_CHOICE, { options: { en: ['A', 'B', 'C'] } });
const note = question(QuestionType.TEXT);
const story = question(QuestionType.LONG_TEXT);
const yesNo = question(QuestionType.BOOLEAN);
const signature = question(QuestionType.SIGNATURE);
const all = [meal, extras, note, story, yesNo, signature];

describe('answersProblem', () => {
  it.each([
    [meal, 0],
    [meal, 1],
    [extras, []],
    [extras, [0, 2]],
    [note, 'x'.repeat(500)],
    [story, 'x'.repeat(4000)],
    [yesNo, false],
  ])('accepts %o answered %p', (q, value) => {
    expect(answersProblem(all, [{ questionId: q.id, value }])).toBeNull();
  });

  it.each([
    [meal, 2, /position/],
    [meal, -1, /position/],
    [meal, 0.5, /position/],
    [meal, 'Fish', /position/],
    [extras, [3], /positions/],
    [extras, [1, 1], /twice/],
    [note, 'x'.repeat(501), /500/],
    [note, 7, /text/],
    [yesNo, 'yes', /true or false/],
    [signature, 'data:image/png', /cannot be answered/],
  ])('refuses %o answered %p', (q, value, message) => {
    expect(answersProblem(all, [{ questionId: q.id, value }])).toMatch(message);
  });

  it('refuses a question that is not on this invitation', () => {
    expect(answersProblem(all, [{ questionId: 'elsewhere', value: 'x' }])).toMatch(/^answers: elsewhere is not/);
  });

  it('refuses the same question answered twice', () => {
    const twice = [
      { questionId: meal.id, value: 0 },
      { questionId: meal.id, value: 1 },
    ];
    expect(answersProblem(all, twice)).toMatch(/twice/);
  });

  // Translations that drifted apart: only positions valid in every language count.
  it('counts only the options every language has', () => {
    const drifted = question(QuestionType.SINGLE_CHOICE, { options: { en: ['A', 'B', 'C'], hy: ['Ա', 'Բ'] } });
    expect(answersProblem([drifted], [{ questionId: drifted.id, value: 2 }])).not.toBeNull();
  });
});

describe('unansweredRequired', () => {
  const required = { ...meal, required: true };

  it('finds a required question someone coming has not answered', () => {
    expect(unansweredRequired([required], new Set(), RsvpStatus.ATTENDING)).toBe(required);
  });

  it.each([RsvpStatus.DECLINED, RsvpStatus.UNDECIDED])('asks nothing of someone %s', (status) => {
    expect(unansweredRequired([required], new Set(), status)).toBeUndefined();
  });

  it('counts an earlier answer', () => {
    expect(unansweredRequired([required], new Set([required.id]), RsvpStatus.ATTENDING)).toBeUndefined();
  });
});
