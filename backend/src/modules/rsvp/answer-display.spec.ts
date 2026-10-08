import { QuestionType, RsvpStatus } from '@prisma/client';
import { formatAnswer, optionLabels, tallyAnswers } from './answer-display';

const meal = { type: QuestionType.SINGLE_CHOICE, options: { hy: ['Միս', 'Ձուկ'], en: ['Meat', 'Fish'] } };
const extras = { type: QuestionType.MULTI_CHOICE, options: { en: ['Shuttle', 'Hotel'] } };
const yesNo = { type: QuestionType.BOOLEAN, options: null };
const note = { type: QuestionType.TEXT, options: null };

describe('optionLabels', () => {
  it('reads the list in the requested language, falling back to the default', () => {
    expect(optionLabels(meal.options, 'en', 'hy')).toEqual(['Meat', 'Fish']);
    expect(optionLabels(meal.options, 'ru', 'hy')).toEqual(['Միս', 'Ձուկ']);
    expect(optionLabels(null, 'en', 'hy')).toEqual([]);
  });
});

describe('formatAnswer', () => {
  const labels = ['Meat', 'Fish'];

  it.each([
    [meal, 1, labels, 'Fish'],
    [extras, [0, 1], ['Shuttle', 'Hotel'], 'Shuttle; Hotel'],
    [yesNo, true, [], 'Yes'],
    [yesNo, false, [], 'No'],
    [note, 'We arrive late', [], 'We arrive late'],
  ])('shows %o answered %p as words', (question, value, optionList, expected) => {
    expect(formatAnswer(question, value, optionList)).toBe(expected);
  });

  // An option removed after it was chosen must still show something honest.
  it('shows a position with no option left as its number', () => {
    expect(formatAnswer(meal, 5, labels)).toBe('#5');
  });
});

describe('tallyAnswers', () => {
  const responses = [
    { status: RsvpStatus.ATTENDING, value: 1 },
    { status: RsvpStatus.ATTENDING, value: 1 },
    { status: RsvpStatus.DECLINED, value: 0 },
  ];

  it('counts each option among those coming and among everyone', () => {
    expect(tallyAnswers(meal, responses, ['Meat', 'Fish'])).toEqual([
      { option: 'Meat', attending: 0, total: 1 },
      { option: 'Fish', attending: 2, total: 2 },
    ]);
  });

  it('counts every choice of a multiple-choice answer', () => {
    const picked = [{ status: RsvpStatus.ATTENDING, value: [0, 1] }];
    expect(tallyAnswers(extras, picked, ['Shuttle', 'Hotel'])).toEqual([
      { option: 'Shuttle', attending: 1, total: 1 },
      { option: 'Hotel', attending: 1, total: 1 },
    ]);
  });

  it('has nothing to count for free text', () => {
    expect(tallyAnswers(note, [{ status: RsvpStatus.ATTENDING, value: 'x' }], [])).toBeNull();
  });
});
