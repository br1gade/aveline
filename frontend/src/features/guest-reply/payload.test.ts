import { describe, expect, it } from 'vitest';

import { initialValues, newPartyRow, type ReplyFormValues } from './form-model';
import { attendingNames, buildPayload } from './payload';
import { contextWith, QUESTIONS, recordWith } from './test-data';

function edit(base: ReplyFormValues, change: Partial<ReplyFormValues>): ReplyFormValues {
  return { ...base, ...change };
}

const initial = initialValues(recordWith(), QUESTIONS);
const DIETARY = {
  isEnabled: true,
  options: [
    { key: 'vegetarian', label: 'Vegetarian' },
    { key: 'vegan', label: 'Vegan' },
  ],
};

describe('buildPayload', () => {
  it('sends each person coming with their own answers, as positions and keys', () => {
    const values = edit(initial, {
      status: 'ATTENDING',
      answers: { ...initial.answers, 'q-main': '1', 'q-multi': ['1'], 'q-bus': 'yes' },
      dietary: ['vegetarian'],
      drinkPreference: 'wine',
      members: [
        { ...initial.members[0]!, answers: { ...initial.members[0]!.answers, 'q-main': '0' } },
      ],
      party: [
        {
          ...newPartyRow(QUESTIONS),
          firstName: ' Narek ',
          dietary: ['vegan'],
          answers: { ...newPartyRow(QUESTIONS).answers, 'q-main': '1' },
        },
        { ...newPartyRow(QUESTIONS), firstName: '  ', lastName: 'Blank' },
      ],
    });
    expect(buildPayload(values, initial, contextWith({ dietary: DIETARY }))).toEqual({
      status: 'ATTENDING',
      party: [
        { firstName: 'Narek', dietary: ['vegan'], answers: [{ questionId: 'q-main', value: 1 }] },
      ],
      dietary: ['vegetarian'],
      drinkPreference: 'wine',
      answers: [
        { questionId: 'q-main', value: 1 },
        { questionId: 'q-multi', value: [1] },
        { questionId: 'q-bus', value: true },
      ],
      members: [
        { guestId: 'g2', status: 'ATTENDING', answers: [{ questionId: 'q-main', value: 0 }] },
      ],
    });
  });

  it('never sends a built-in question the invitation does not ask', () => {
    const values = edit(initial, {
      status: 'ATTENDING',
      drinkPreference: 'wine',
      songRequest: 'Sirun Yar',
      message: 'Hi',
    });
    const context = contextWith({
      drinkPreference: { isEnabled: false, options: null },
      songRequest: { isEnabled: false, options: null },
      message: { isEnabled: false, options: null },
    });
    expect(buildPayload(values, initial, context)).toEqual({
      status: 'ATTENDING',
      members: [{ guestId: 'g2', status: 'ATTENDING' }],
    });
  });

  it('sends a member answered apart without the questions they are not asked', () => {
    const values = edit(initial, {
      status: 'ATTENDING',
      members: [
        {
          ...initial.members[0]!,
          status: 'DECLINED',
          answers: { ...initial.members[0]!.answers, 'q-main': '0' },
        },
      ],
    });
    expect(buildPayload(values, initial, contextWith()).members).toEqual([
      { guestId: 'g2', status: 'DECLINED' },
    ]);
  });

  it('sends only the answer and what changed on an edit', () => {
    const saved = initialValues(
      recordWith({
        status: 'ATTENDING',
        message: 'See you',
        songRequest: 'Sirun Yar',
        answers: [{ questionId: 'q-main', value: 0 }],
      }),
      QUESTIONS,
    );
    const before = { ...saved, members: [{ ...saved.members[0]!, status: 'ATTENDING' as const }] };
    expect(buildPayload(edit(before, { message: 'See you soon' }), before, contextWith())).toEqual({
      status: 'ATTENDING',
      message: 'See you soon',
    });
  });

  it('declining sends no attending details, and the household follows', () => {
    const values = edit(initial, {
      status: 'DECLINED',
      drinkPreference: 'wine',
      party: [{ ...newPartyRow(QUESTIONS), firstName: 'Narek' }],
    });
    expect(buildPayload(values, initial, contextWith())).toEqual({
      status: 'DECLINED',
      members: [{ guestId: 'g2', status: 'DECLINED' }],
    });
  });

  it('stores the language the guest switched to', () => {
    const values = edit(initial, { status: 'UNDECIDED' });
    expect(buildPayload(values, initial, contextWith({}, 'ru')).locale).toBe('ru');
    expect(buildPayload(values, initial, contextWith()).locale).toBeUndefined();
  });
});

describe('attendingNames', () => {
  it('lists the respondent, the household members coming and the added guests', () => {
    const values = edit(initial, {
      status: 'ATTENDING',
      party: [{ ...newPartyRow(QUESTIONS), firstName: 'Narek', lastName: 'Petrosyan' }],
    });
    expect(attendingNames(values, 'Armen Petrosyan')).toEqual([
      'Armen Petrosyan',
      'Lusine Petrosyan',
      'Narek Petrosyan',
    ]);
  });
});
