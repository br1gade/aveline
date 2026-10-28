import { describe, expect, it } from 'vitest';

import { initialValues, newPartyRow, type ReplyFormValues } from './form-model';
import { attendingNames, buildPayload } from './payload';
import { contextWith, perVenueRecord, QUESTIONS, recordWith } from './test-data';

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
      attendanceRevision: 1,
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
      attendanceRevision: 1,
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
      attendanceRevision: 1,
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
      attendanceRevision: 1,
      members: [{ guestId: 'g2', status: 'DECLINED' }],
    });
  });

  it('stores the language the guest switched to', () => {
    const values = edit(initial, { status: 'UNDECIDED' });
    expect(buildPayload(values, initial, contextWith({}, 'ru')).locale).toBe('ru');
    expect(buildPayload(values, initial, contextWith()).locale).toBeUndefined();
  });
});

describe('after the host changed how guests answer', () => {
  const VENUE_IDS = ['v-church', 'v-hall'];
  const perVenueContext = contextWith({}, undefined, { revision: 2, venueIds: VENUE_IDS });

  it('sends the revision it read, even for one answer for the whole event', () => {
    const record = recordWith();
    const context = contextWith({}, undefined, { revision: 3, venueIds: [] });
    const start = initialValues(record, QUESTIONS);
    expect(buildPayload(edit(start, { status: 'DECLINED' }), start, context)).toMatchObject({
      status: 'DECLINED',
      attendanceRevision: 3,
    });
  });

  it('answers each venue instead of the event, for everyone, since nobody follows', () => {
    const start = initialValues(perVenueRecord(), QUESTIONS);
    const values = edit(start, {
      venues: { 'v-church': 'ATTENDING', 'v-hall': 'DECLINED' },
      members: [
        { ...start.members[0]!, venues: { 'v-church': '', 'v-hall': 'ATTENDING' } },
        start.members[1]!,
      ],
      party: [{ ...newPartyRow(QUESTIONS), firstName: 'Narek' }],
    });
    const body = buildPayload(values, start, perVenueContext);
    expect(body).not.toHaveProperty('status');
    expect(body.attendanceRevision).toBe(2);
    expect(body.venueAttendance).toEqual([
      { venueId: 'v-church', status: 'ATTENDING' },
      { venueId: 'v-hall', status: 'DECLINED' },
    ]);
    expect(body.members).toEqual([
      {
        guestId: 'g2',
        venueAttendance: [
          { venueId: 'v-church', status: 'ATTENDING' },
          { venueId: 'v-hall', status: 'ATTENDING' },
        ],
      },
      {
        guestId: 'g3',
        venueAttendance: [
          { venueId: 'v-church', status: 'ATTENDING' },
          { venueId: 'v-hall', status: 'DECLINED' },
        ],
      },
    ]);
    expect(body.party).toEqual([
      {
        firstName: 'Narek',
        venueAttendance: [
          { venueId: 'v-church', status: 'ATTENDING' },
          { venueId: 'v-hall', status: 'DECLINED' },
        ],
      },
    ]);
  });

  it('leaves out a member whose venues are as they were saved', () => {
    const answered = { 'v-church': 'ATTENDING', 'v-hall': 'ATTENDING' } as const;
    const record = perVenueRecord(answered, answered);
    const start = initialValues(record, QUESTIONS);
    const values = edit(start, {
      members: [start.members[0]!, { ...start.members[1]!, venues: { ...answered } }],
    });
    const body = buildPayload(values, start, perVenueContext);
    expect(body.members?.map((member) => member.guestId)).toEqual(['g3']);
  });

  it('counts someone coming to any venue as coming', () => {
    const start = initialValues(perVenueRecord(), QUESTIONS);
    const values = edit(start, { venues: { 'v-church': 'DECLINED', 'v-hall': 'ATTENDING' } });
    expect(attendingNames(values, 'Armen Petrosyan', VENUE_IDS)).toEqual([
      'Armen Petrosyan',
      'Lusine Petrosyan',
      'Davit',
    ]);
  });
});

describe('attendingNames', () => {
  it('lists the respondent, the household members coming and the added guests', () => {
    const values = edit(initial, {
      status: 'ATTENDING',
      party: [{ ...newPartyRow(QUESTIONS), firstName: 'Narek', lastName: 'Petrosyan' }],
    });
    expect(attendingNames(values, 'Armen Petrosyan', [])).toEqual([
      'Armen Petrosyan',
      'Lusine Petrosyan',
      'Narek Petrosyan',
    ]);
  });
});
