import { describe, expect, it } from 'vitest';

import {
  carryOver,
  initialValues,
  neverAnswered,
  newPartyRow,
  replySchema,
  type ReplyFormValues,
} from './form-model';
import { perVenueRecord, QUESTIONS, recordWith } from './test-data';

function edit(base: ReplyFormValues, change: Partial<ReplyFormValues>): ReplyFormValues {
  return { ...base, ...change };
}

describe('initialValues', () => {
  it('starts a first reply with nothing chosen, and never offers a SIGNATURE question (PD-23)', () => {
    const values = initialValues(recordWith(), QUESTIONS);
    expect(values.status).toBe('');
    expect(Object.keys(values.answers)).toEqual(['q-main', 'q-multi', 'q-bus', 'q-note']);
    expect(values.members[0]).toMatchObject({
      guestId: 'g2',
      name: 'Lusine Petrosyan',
      status: '',
    });
  });

  it('fills an earlier reply, answers in their input form, and members’ own answers empty', () => {
    const values = initialValues(
      recordWith({
        status: 'ATTENDING',
        songRequest: 'Sirun Yar',
        answers: [
          { questionId: 'q-main', value: 1 },
          { questionId: 'q-multi', value: [0, 1] },
          { questionId: 'q-bus', value: false },
        ],
      }),
      QUESTIONS,
    );
    expect(values.status).toBe('ATTENDING');
    expect(values.songRequest).toBe('Sirun Yar');
    expect(values.answers).toMatchObject({
      'q-main': '1',
      'q-multi': ['0', '1'],
      'q-bus': 'no',
      'q-note': '',
    });
    expect(values.members[0]?.answers).toEqual({
      'q-main': '',
      'q-multi': [],
      'q-bus': '',
      'q-note': '',
    });
  });
});

describe('replySchema', () => {
  const record = recordWith();
  const initial = initialValues(record, QUESTIONS);
  const schema = replySchema({
    questions: QUESTIONS,
    neverAnswered: neverAnswered(record),
    venueIds: [],
  });

  function issues(values: ReplyFormValues) {
    const result = schema.safeParse(values);
    return result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
  }

  it('asks for an answer first', () => {
    expect(issues(initial)).toContain('status:chooseAnswer');
  });

  it('binds everyone coming to the host’s required questions, and nobody declining (C-17)', () => {
    expect(issues(edit(initial, { status: 'ATTENDING' }))).toEqual([
      'answers.q-main:required',
      'members.0.answers.q-main:required',
    ]);
    expect(issues(edit(initial, { status: 'DECLINED' }))).toEqual([]);
  });

  it('leaves a member who has answered before to the server, which counts their earlier answers', () => {
    const answered = recordWith();
    answered.household.members[0]!.status = 'ATTENDING';
    const values = edit(initialValues(answered, QUESTIONS), {
      status: 'ATTENDING',
      answers: { ...initial.answers, 'q-main': '0' },
    });
    const schemaForAnswered = replySchema({
      questions: QUESTIONS,
      neverAnswered: neverAnswered(answered),
      venueIds: [],
    });
    expect(schemaForAnswered.safeParse(values).success).toBe(true);
  });

  it('asks an added guest the required questions, and needs their first name', () => {
    const values = edit(initial, {
      status: 'ATTENDING',
      answers: { ...initial.answers, 'q-main': '0' },
      members: [{ ...initial.members[0]!, status: 'DECLINED' }],
      party: [{ ...newPartyRow(QUESTIONS), firstName: ' ' }],
      songRequest: 'x'.repeat(201),
    });
    expect(issues(values)).toEqual([
      'songRequest:tooLong',
      'party.0.firstName:firstName',
      'party.0.answers.q-main:required',
    ]);
  });

  it('ignores a guest row left behind by switching to declining', () => {
    const values = edit(initial, {
      status: 'DECLINED',
      party: [newPartyRow(QUESTIONS)],
    });
    expect(issues(values)).toEqual([]);
  });
});

describe('answering per venue', () => {
  const record = perVenueRecord();
  const initial = initialValues(record, QUESTIONS);
  const schema = replySchema({
    questions: QUESTIONS,
    neverAnswered: neverAnswered(record),
    venueIds: ['v-church', 'v-hall'],
  });

  function issues(values: ReplyFormValues) {
    const result = schema.safeParse(values);
    return result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
  }

  it('starts every venue unanswered, for the respondent and each member', () => {
    expect(initial.venues).toEqual({ 'v-church': '', 'v-hall': '' });
    expect(initial.members[1]?.venues).toEqual({ 'v-church': '', 'v-hall': '' });
  });

  it('asks the respondent for every venue, and not for one answer for the event', () => {
    expect(issues(edit(initial, { venues: { 'v-church': 'DECLINED', 'v-hall': '' } }))).toEqual([
      'venues.v-hall:chooseVenue',
    ]);
  });

  it('binds the questions to everyone coming to any venue', () => {
    const values = edit(initial, { venues: { 'v-church': 'DECLINED', 'v-hall': 'ATTENDING' } });
    expect(issues(values)).toEqual([
      'answers.q-main:required',
      'members.0.answers.q-main:required',
      'members.1.answers.q-main:required',
    ]);
  });
});

describe('carryOver', () => {
  it('keeps what was typed and asks again who is coming, from the fresh reply', () => {
    const typed = edit(initialValues(recordWith(), QUESTIONS), {
      status: 'ATTENDING',
      message: 'See you there',
      answers: { 'q-main': '1' },
      party: [{ ...newPartyRow(QUESTIONS), firstName: 'Narek' }],
    });
    typed.members = [{ ...typed.members[0]!, status: 'DECLINED', dietaryNotes: 'No nuts' }];
    const fresh = initialValues(perVenueRecord(), QUESTIONS);

    const kept = carryOver(typed, fresh);

    expect(kept.status).toBe(fresh.status);
    expect(kept.venues).toEqual({ 'v-church': '', 'v-hall': '' });
    expect(kept.message).toBe('See you there');
    expect(kept.answers).toEqual({ 'q-main': '1' });
    expect(kept.party.map((row) => row.firstName)).toEqual(['Narek']);
    expect(
      kept.members.map((member) => [member.guestId, member.status, member.dietaryNotes]),
    ).toEqual([
      ['g2', '', 'No nuts'],
      ['g3', '', ''],
    ]);
  });
});
