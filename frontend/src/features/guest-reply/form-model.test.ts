import { describe, expect, it } from 'vitest';

import type { RsvpQuestion } from '@/features/invitation-renderer';
import { ApiError, networkError } from '@/api/errors';

import {
  attendingNames,
  buildPayload,
  initialValues,
  replySchema,
  type ReplyFormValues,
} from './form-model';
import { classifySendError } from './server-errors';
import type { ReplyRecord } from './types';

const QUESTIONS: RsvpQuestion[] = [
  {
    id: 'q-main',
    type: 'SINGLE_CHOICE',
    required: true,
    prompt: 'Main course',
    options: ['Beef', 'Fish'],
  },
  {
    id: 'q-multi',
    type: 'MULTI_CHOICE',
    required: false,
    prompt: 'Activities',
    options: ['Dance', 'Toast'],
  },
  { id: 'q-bus', type: 'BOOLEAN', required: false, prompt: 'Shuttle?', options: [] },
  { id: 'q-note', type: 'TEXT', required: false, prompt: 'Note', options: [] },
  { id: 'q-sign', type: 'SIGNATURE', required: true, prompt: 'Sign', options: [] },
];

function record(overrides: Partial<ReplyRecord['rsvp']> = {}): ReplyRecord {
  return {
    guest: { id: 'g1', firstName: 'Armen', lastName: 'Petrosyan' },
    household: {
      name: 'Petrosyan family',
      seatsAllotted: 3,
      members: [
        {
          id: 'g2',
          firstName: 'Lusine',
          lastName: 'Petrosyan',
          addedByGuest: false,
          status: 'PENDING',
          dietary: [],
          dietaryNotes: null,
        },
      ],
    },
    rsvp: { status: 'PENDING', answers: [], ...overrides },
  };
}

function edit(base: ReplyFormValues, change: Partial<ReplyFormValues>): ReplyFormValues {
  return { ...base, ...change };
}

describe('initialValues', () => {
  it('starts a first reply with nothing chosen, and never offers a SIGNATURE question (PD-23)', () => {
    const values = initialValues(record(), QUESTIONS);
    expect(values.status).toBe('');
    expect(values.members).toEqual([
      { guestId: 'g2', name: 'Lusine Petrosyan', status: '', dietary: [], dietaryNotes: '' },
    ]);
    expect(Object.keys(values.answers)).toEqual(['q-main', 'q-multi', 'q-bus', 'q-note']);
  });

  it('fills an earlier reply, answers in their input form', () => {
    const values = initialValues(
      record({
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
  });
});

describe('buildPayload', () => {
  const initial = initialValues(record(), QUESTIONS);

  it('sends the household, the plus-one and the answers as positions', () => {
    const values = edit(initial, {
      status: 'ATTENDING',
      party: [
        { firstName: ' Narek ', lastName: '' },
        { firstName: '  ', lastName: 'Blank' },
      ],
      dietary: ['vegetarian'],
      drinkPreference: 'wine',
      answers: { ...initial.answers, 'q-main': '1', 'q-multi': ['1'], 'q-bus': 'yes' },
    });
    expect(buildPayload(values, initial, QUESTIONS)).toEqual({
      status: 'ATTENDING',
      party: [{ firstName: 'Narek' }],
      dietary: ['vegetarian'],
      drinkPreference: 'wine',
      members: [{ guestId: 'g2', status: 'ATTENDING' }],
      answers: [
        { questionId: 'q-main', value: 1 },
        { questionId: 'q-multi', value: [1] },
        { questionId: 'q-bus', value: true },
      ],
    });
  });

  it('lets a member be answered for apart from the respondent', () => {
    const values = edit(initial, {
      status: 'ATTENDING',
      members: [
        {
          guestId: 'g2',
          name: 'Lusine Petrosyan',
          status: 'DECLINED',
          dietary: [],
          dietaryNotes: '',
        },
      ],
    });
    expect(buildPayload(values, initial, QUESTIONS).members).toEqual([
      { guestId: 'g2', status: 'DECLINED' },
    ]);
  });

  it('sends only the answer and what changed on an edit', () => {
    const saved = initialValues(
      record({
        status: 'ATTENDING',
        message: 'See you',
        songRequest: 'Sirun Yar',
        answers: [{ questionId: 'q-main', value: 0 }],
      }),
      QUESTIONS,
    );
    const savedMembers = {
      ...saved,
      members: [{ ...saved.members[0]!, status: 'ATTENDING' as const }],
    };
    const values = edit(savedMembers, { message: 'See you soon' });
    expect(buildPayload(values, savedMembers, QUESTIONS)).toEqual({
      status: 'ATTENDING',
      message: 'See you soon',
    });
  });

  it('declining sends no attending details, and the household follows', () => {
    const values = edit(initial, {
      status: 'DECLINED',
      drinkPreference: 'wine',
      party: [{ firstName: 'Narek', lastName: '' }],
    });
    expect(buildPayload(values, initial, QUESTIONS)).toEqual({
      status: 'DECLINED',
      members: [{ guestId: 'g2', status: 'DECLINED' }],
    });
  });
});

describe('replySchema', () => {
  const initial = initialValues(record(), QUESTIONS);
  const schema = replySchema(QUESTIONS);

  function issues(values: ReplyFormValues) {
    const result = schema.safeParse(values);
    return result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
  }

  it('asks for an answer first', () => {
    expect(issues(initial)).toContain('status:chooseAnswer');
  });

  it('requires the host’s required questions of attending guests only (C-17)', () => {
    expect(issues(edit(initial, { status: 'ATTENDING' }))).toEqual(['answers.q-main:required']);
    expect(issues(edit(initial, { status: 'DECLINED' }))).toEqual([]);
  });

  it('needs a first name for each added guest, and holds the server’s limits', () => {
    const values = edit(initial, {
      status: 'DECLINED',
      party: [{ firstName: ' ', lastName: '' }],
      songRequest: 'x'.repeat(201),
    });
    expect(issues(values)).toEqual(['party.0.firstName:firstName', 'songRequest:tooLong']);
  });
});

describe('attendingNames', () => {
  it('lists the respondent, the household members coming and the plus-ones', () => {
    const values = edit(initialValues(record(), QUESTIONS), {
      status: 'ATTENDING',
      party: [{ firstName: 'Narek', lastName: 'Petrosyan' }],
    });
    expect(attendingNames(values, 'Armen Petrosyan')).toEqual([
      'Armen Petrosyan',
      'Lusine Petrosyan',
      'Narek Petrosyan',
    ]);
  });
});

describe('classifySendError', () => {
  function badRequest(...messages: string[]) {
    return new ApiError({ status: 400, messages, requestId: 'req-1' });
  }

  it('maps the server’s prefixes onto the form’s sections', () => {
    expect(
      classifySendError(
        badRequest(
          'answers: q-main is required for a guest who is coming',
          'answers: q-multi must be a list of positions of its options',
          'members: g9 is not in this household',
          'This invitation allows 3 guest(s); 2 already named and 2 more were submitted',
          'message must be shorter than or equal to 1000 characters',
        ),
      ),
    ).toEqual({
      kind: 'invalid',
      hasOther: true,
      fields: [
        { field: 'answers.q-main', code: 'required' },
        { field: 'answers.q-multi', code: 'invalidAnswer' },
        { field: 'members', code: 'members' },
        { field: 'party', code: 'seats' },
      ],
    });
  });

  it.each(['This invitation has closed', 'This invitation is not accepting responses'])(
    'treats “%s” as closed while sending',
    (message) => {
      expect(classifySendError(badRequest(message))).toEqual({ kind: 'closed' });
    },
  );

  it('separates too many requests from a failure, and keeps the reference', () => {
    expect(classifySendError(new ApiError({ status: 429, messages: [] }))).toEqual({
      kind: 'rate-limited',
    });
    expect(
      classifySendError(new ApiError({ status: 503, messages: [], requestId: 'req-2' })),
    ).toEqual({
      kind: 'failed',
      requestId: 'req-2',
    });
    expect(classifySendError(networkError('req-3'))).toEqual({
      kind: 'failed',
      requestId: 'req-3',
    });
  });
});
