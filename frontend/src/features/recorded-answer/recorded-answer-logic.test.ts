import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';
import type { Design } from '@/features/invitation-design';

import { askingOf, type Asking } from './asking';
import { answerFormValues, type AnswerFormValues } from './form-model';
import { answerPayload } from './payload';
import { readAnsweringGuest } from './read';
import { refusalOf, SENTENCES } from './refusals';
import { answerFormSchema } from './schemas';
import type { AnsweringGuest, GuestAnswerWire } from './types';

const OFF = { isEnabled: false, options: null };

const DESIGN: Pick<Design, 'questions' | 'rsvpFields'> = {
  questions: [
    {
      id: 'q-meal',
      type: 'SINGLE_CHOICE',
      required: true,
      prompt: { hy: 'Ճաշ', en: 'Meal' },
      options: { hy: ['Միս', 'Ձուկ'], en: ['Meat', 'Fish'] },
      answerCount: 3,
      statementVersionId: null,
    },
    {
      id: 'q-car',
      type: 'BOOLEAN',
      required: false,
      prompt: { en: 'Do you need parking?' },
      options: {},
      answerCount: 0,
      statementVersionId: null,
    },
    {
      id: 'q-songs',
      type: 'MULTI_CHOICE',
      required: false,
      prompt: { en: 'Dances' },
      options: { en: ['Waltz', 'Kochari', 'Tango'] },
      answerCount: 0,
      statementVersionId: null,
    },
    {
      id: 'q-note',
      type: 'TEXT',
      required: false,
      prompt: { en: 'Anything else?' },
      options: {},
      answerCount: 0,
      statementVersionId: null,
    },
    {
      id: 'q-photos',
      type: 'SIGNATURE',
      required: true,
      prompt: { en: 'I agree to be photographed' },
      options: {},
      answerCount: 0,
      statementVersionId: 'sv1',
    },
  ],
  rsvpFields: {
    dietary: {
      isEnabled: true,
      options: [
        { key: 'vegetarian', label: { en: 'Vegetarian', hy: 'Բուսակեր' } },
        { key: 'halal', label: { en: 'Halal' } },
      ],
    },
    drinkPreference: { isEnabled: true, options: null },
    songRequest: OFF,
    message: { isEnabled: true, options: null },
    attribution: { isEnabled: true, options: null },
  },
};

const ASKING: Asking = askingOf(DESIGN, 'en');

function wire(overrides: Partial<GuestAnswerWire> = {}): GuestAnswerWire {
  return {
    id: 'g1',
    name: 'Armen Petrosyan',
    token: 'secret-token',
    email: 'armen@example.am',
    phone: '+37491000000',
    isAnonymized: false,
    attendance: { mode: 'EVENT_WIDE', revision: 1, status: 'ATTENDING', venues: [] },
    rsvpStatus: 'ATTENDING',
    rsvp: {
      status: 'ATTENDING',
      dietary: ['vegetarian'],
      dietaryNotes: null,
      drinkPreference: 'Wine',
      songRequest: null,
      message: null,
    },
    answers: [
      { questionId: 'q-meal', value: 1 },
      { questionId: 'q-photos', value: { acknowledgementId: 'a1' } },
    ],
    ...overrides,
  };
}

const PER_VENUE = {
  mode: 'PER_VENUE' as const,
  revision: 3,
  status: 'PENDING',
  venues: [
    { venueId: 'church', venue: 'Saint Gayane', status: 'ATTENDING' },
    { venueId: 'hall', venue: 'The hall', status: 'PENDING' },
  ],
};

describe('reading the guest', () => {
  it('keeps the answer so far and never the guest’s token or contacts', () => {
    const guest = readAnsweringGuest(wire());
    expect(guest).toMatchObject({
      reply: 'ATTENDING',
      mode: 'EVENT_WIDE',
      revision: 1,
      dietary: ['vegetarian'],
      drinkPreference: 'Wine',
      answers: { 'q-meal': 1 },
    });
    expect(JSON.stringify(guest)).not.toContain('secret-token');
    expect(JSON.stringify(guest)).not.toContain('armen@example.am');
  });

  it('reads an answer from before attendance modes as one for the event, at revision 1', () => {
    const { attendance: _left, ...older } = wire();
    expect(readAnsweringGuest(older)).toMatchObject({
      mode: 'EVENT_WIDE',
      revision: 1,
      venues: [],
    });
  });

  it('reads no answer as none, and each venue’s in PER_VENUE', () => {
    const guest = readAnsweringGuest({
      ...wire({ attendance: PER_VENUE, rsvpStatus: 'PENDING' }),
      rsvp: {
        status: 'PENDING',
        dietary: [],
        dietaryNotes: null,
        drinkPreference: null,
        songRequest: null,
        message: null,
      },
    });
    expect(guest.reply).toBeNull();
    expect(guest.venues).toEqual([
      { venueId: 'church', venue: 'Saint Gayane', reply: 'ATTENDING' },
      { venueId: 'hall', venue: 'The hall', reply: null },
    ]);
  });
});

describe('what the invitation asks, for the host', () => {
  it('words each question in the default language, else the first it has', () => {
    const hy = askingOf(DESIGN, 'hy');
    expect(hy.questions[0]).toMatchObject({
      prompt: { text: 'Ճաշ', language: 'hy' },
      options: ['Միս', 'Ձուկ'],
      isRequired: true,
    });
    expect(hy.questions[1]?.prompt).toEqual({ text: 'Do you need parking?', language: 'en' });
    expect(hy.fields[0]?.options?.[1]?.label).toEqual({ text: 'Halal', language: 'en' });
  });

  it('offers only the built-ins switched on, never whose side someone is on', () => {
    expect(ASKING.fields.map((field) => field.field)).toEqual([
      'dietary',
      'drinkPreference',
      'message',
    ]);
  });
});

describe('the form', () => {
  it('shows the answers so far, a signature never among them', () => {
    const values = answerFormValues(readAnsweringGuest(wire()), ASKING);
    expect(values).toMatchObject({
      status: 'ATTENDING',
      dietary: ['vegetarian'],
      dietaryText: '',
      answers: { 'q-meal': '1', 'q-car': '', 'q-songs': [], 'q-note': '' },
      notifyGuest: false,
    });
    expect(values.answers).not.toHaveProperty('q-photos');
  });

  it('shows free-text dietary needs as text', () => {
    const asking = askingOf(
      {
        ...DESIGN,
        rsvpFields: { ...DESIGN.rsvpFields, dietary: { isEnabled: true, options: null } },
      },
      'en',
    );
    expect(answerFormValues(readAnsweringGuest(wire()), asking)).toMatchObject({
      dietary: [],
      dietaryText: 'vegetarian',
    });
  });
});

describe('the checks before sending', () => {
  const guest = readAnsweringGuest(wire());
  const initial = answerFormValues(guest, ASKING);
  const problems = (mode: 'EVENT_WIDE' | 'PER_VENUE', values: AnswerFormValues) => {
    const result = answerFormSchema(mode, ASKING).safeParse(values);
    return result.success
      ? []
      : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
  };

  it('needs an event-wide answer, and in PER_VENUE one venue’s at least', () => {
    expect(problems('EVENT_WIDE', { ...initial, status: '' })).toEqual([
      ['status', 'chooseAnswer'],
    ]);
    expect(problems('PER_VENUE', { ...initial, venues: { church: '', hall: '' } })).toEqual([
      ['venues', 'chooseVenue'],
    ]);
    expect(problems('PER_VENUE', { ...initial, venues: { church: '', hall: 'DECLINED' } })).toEqual(
      [],
    );
  });

  it('never requires a question the guest’s page requires', () => {
    expect(
      problems('EVENT_WIDE', { ...initial, answers: { ...initial.answers, 'q-meal': '' } }),
    ).toEqual([]);
  });

  it.each([
    ['dietaryText', 40],
    ['dietaryNotes', 500],
    ['drinkPreference', 80],
    ['songRequest', 200],
    ['message', 1000],
  ] as const)('takes %s up to %i characters, and no more', (field, limit) => {
    expect(problems('EVENT_WIDE', { ...initial, [field]: 'x'.repeat(limit) })).toEqual([]);
    expect(problems('EVENT_WIDE', { ...initial, [field]: 'x'.repeat(limit + 1) })).toEqual([
      [field, 'tooLong'],
    ]);
  });

  it('takes a short answer up to 500 characters and a long one up to 4,000', () => {
    const long = askingOf(
      {
        ...DESIGN,
        questions: [
          { ...DESIGN.questions[3], id: 'q-long', type: 'LONG_TEXT' },
        ] as typeof DESIGN.questions,
      },
      'en',
    );
    const at = (text: string) =>
      answerFormSchema('EVENT_WIDE', long).safeParse({ ...initial, answers: { 'q-long': text } })
        .success;
    expect(at('x'.repeat(4000))).toBe(true);
    expect(at('x'.repeat(4001))).toBe(false);
    expect(
      problems('EVENT_WIDE', {
        ...initial,
        answers: { ...initial.answers, 'q-note': 'x'.repeat(500) },
      }),
    ).toEqual([]);
  });

  it('keeps the backend’s limits', () => {
    expect(
      problems('EVENT_WIDE', {
        ...initial,
        drinkPreference: 'x'.repeat(81),
        message: 'x'.repeat(1000),
        answers: { ...initial.answers, 'q-note': 'x'.repeat(501) },
      }),
    ).toEqual([
      ['drinkPreference', 'tooLong'],
      ['answers.q-note', 'tooLong'],
    ]);
  });
});

describe('answerPayload', () => {
  const guest = readAnsweringGuest(wire());
  const initial = answerFormValues(guest, ASKING);
  const payload = (changes: Partial<AnswerFormValues>, who: AnsweringGuest = guest) =>
    answerPayload(who, ASKING, initial, { ...initial, ...changes });

  it('sends the event-wide answer and the revision even when nothing else changed', () => {
    expect(payload({})).toEqual({ attendanceRevision: 1, status: 'ATTENDING' });
  });

  it('sends each changed built-in, and clears one emptied', () => {
    expect(
      payload({
        status: 'DECLINED',
        dietary: ['halal', 'vegetarian'],
        drinkPreference: '',
        message: ' Thanks ',
      }),
    ).toEqual({
      attendanceRevision: 1,
      status: 'DECLINED',
      dietary: ['halal', 'vegetarian'],
      drinkPreference: '',
      message: 'Thanks',
    });
  });

  it('sends each changed answer as the backend takes it, and none emptied', () => {
    expect(
      payload({
        answers: { 'q-meal': '', 'q-car': 'yes', 'q-songs': ['2', '0'], 'q-note': ' Late ' },
      }).answers,
    ).toEqual([
      { questionId: 'q-car', value: true },
      { questionId: 'q-songs', value: [0, 2] },
      { questionId: 'q-note', value: 'Late' },
    ]);
  });

  it('sends nothing for the same choices in another order', () => {
    const chosen = payload({ dietary: ['halal', 'vegetarian'] }, guest);
    const start = { ...initial, dietary: ['halal', 'vegetarian'] };
    expect(
      answerPayload(guest, ASKING, start, { ...start, dietary: ['vegetarian', 'halal'] }),
    ).toEqual({
      attendanceRevision: 1,
      status: 'ATTENDING',
    });
    expect(chosen.dietary).toEqual(['halal', 'vegetarian']);
  });

  it('sends a “no” as false, and changed dietary notes', () => {
    expect(
      payload({ answers: { ...initial.answers, 'q-car': 'no' }, dietaryNotes: ' No nuts ' }),
    ).toMatchObject({ answers: [{ questionId: 'q-car', value: false }], dietaryNotes: 'No nuts' });
  });

  it('sends free-text dietary needs as one, and none for one emptied', () => {
    const asking = askingOf(
      {
        ...DESIGN,
        rsvpFields: { ...DESIGN.rsvpFields, dietary: { isEnabled: true, options: null } },
      },
      'en',
    );
    const start = answerFormValues(guest, asking);
    expect(
      answerPayload(guest, asking, start, { ...start, dietaryText: ' No gluten ' }).dietary,
    ).toEqual(['No gluten']);
    expect(answerPayload(guest, asking, start, { ...start, dietaryText: '' }).dietary).toEqual([]);
  });

  it('sends a changed choice as its position', () => {
    expect(payload({ answers: { ...initial.answers, 'q-meal': '0' } }).answers).toEqual([
      { questionId: 'q-meal', value: 0 },
    ]);
  });

  it('tells the guest only when asked', () => {
    expect(payload({ notifyGuest: true })).toMatchObject({ notifyGuest: true });
    expect(payload({})).not.toHaveProperty('notifyGuest');
  });

  describe('in PER_VENUE', () => {
    const perVenue = readAnsweringGuest(wire({ attendance: PER_VENUE }));
    const start = answerFormValues(perVenue, ASKING);
    const send = (changes: Partial<AnswerFormValues>) =>
      answerPayload(perVenue, ASKING, start, { ...start, ...changes });

    it('sends only the venues changed, never an event-wide status', () => {
      expect(send({ venues: { church: 'ATTENDING', hall: 'DECLINED' } })).toEqual({
        attendanceRevision: 3,
        venueAttendance: [{ venueId: 'hall', status: 'DECLINED' }],
      });
    });

    it('sends the venues already answered again when only something else changed', () => {
      expect(send({ message: 'See you' })).toEqual({
        attendanceRevision: 3,
        venueAttendance: [{ venueId: 'church', status: 'ATTENDING' }],
        message: 'See you',
      });
    });
  });
});

describe('refusalOf', () => {
  const refused = (status: number, message = 'refused') =>
    new ApiError({ status, messages: [message], requestId: `r-${status}` });

  it.each([
    [refused(403), { kind: 'forbidden' }],
    [refused(429), { kind: 'rateLimited' }],
    [refused(500), { kind: 'noAnswer', requestId: 'r-500' }],
    [refused(499, 'Something new'), { kind: 'other' }],
    [networkError(), { kind: 'noAnswer' }],
    [refused(404, 'No guest g1 on this event'), { kind: 'gone', isStale: true }],
    [
      refused(400, 'answers: q-meal must be the position of one of its options'),
      { kind: 'questionRefused', questionId: 'q-meal', isStale: true },
    ],
    [
      refused(400, 'answers: q-x is not a question on this invitation'),
      { kind: 'questionRefused', questionId: 'q-x' },
    ],
    [
      refused(400, 'drinkPreference: this invitation does not ask for it'),
      { kind: 'fieldRefused', isStale: true },
    ],
    [refused(400, 'dietary: choose from vegan, halal'), { kind: 'fieldRefused' }],
    [
      refused(400, 'venueAttendance: venue is not guest-facing on this event'),
      { kind: 'venueRefused', isStale: true },
    ],
    [
      refused(400, 'status: omit in per-venue mode; use venueAttendance'),
      { kind: 'modeChanged', isStale: true },
    ],
    [refused(400, 'Something new'), { kind: 'other', sentence: 'Something new' }],
  ])('words %#', (error, expected) => {
    expect(refusalOf(error)).toMatchObject(expected);
  });

  it.each(SENTENCES.map(([words, kind, isStale]) => [words, kind, isStale]))(
    'recognises “%s”',
    (words, kind, isStale) => {
      expect(refusalOf(refused(400, words))).toMatchObject({ kind, isStale });
    },
  );

  it('recognises a change of how guests answer by its code', () => {
    const error = new ApiError({
      status: 409,
      messages: ['anything'],
      feedback: {
        code: 'ATTENDANCE_CHANGED',
        action: 'RELOAD',
        userMessage: undefined,
        details: [],
      },
    });
    expect(refusalOf(error)).toEqual({ kind: 'policyChanged', isStale: true });
  });

  it('throws on what isn’t the API’s', () => {
    expect(() => refusalOf(new Error('bug'))).toThrow('bug');
  });
});

describe('the choices offered', () => {
  it('stop at the shortest language’s list, as the backend takes no position past it', () => {
    const uneven = askingOf(
      {
        ...DESIGN,
        questions: [
          {
            ...DESIGN.questions[0],
            options: { en: ['Meat', 'Fish', 'Vegan'], hy: ['Միս', 'Ձուկ'] },
          },
        ] as typeof DESIGN.questions,
      },
      'en',
    );
    expect(uneven.questions[0]).toMatchObject({ options: ['Meat', 'Fish'], optionsLanguage: 'en' });
  });
});

describe('the backend’s sentences', () => {
  it('are still in its sources', () => {
    const source = join(process.cwd(), '..', 'backend', 'src', 'modules');
    const sources = [
      'rsvp/host-rsvp.service.ts',
      'rsvp/answer-writes.ts',
      'rsvp/attendance/attendance-context.ts',
      'guest-contributions/acknowledgement-writes.ts',
      'rsvp/answers.ts',
      'rsvp/rsvp-fields.ts',
      'rsvp/dto/host-rsvp.dto.ts',
      'rsvp/dto/submit-rsvp.dto.ts',
    ]
      .map((path) => readFileSync(join(source, path), 'utf8'))
      .join('');
    for (const [words] of SENTENCES) expect(sources).toContain(words);
    for (const words of [
      'is not a question on this invitation',
      'is answered twice',
      'this invitation does not ask for it',
      '${field}: choose from',
      'venueAttendance: a venue is answered twice',
      'venueAttendance: venue is not guest-facing on this event',
      'status: omit in per-venue mode',
      'status: required for event-wide attendance',
      'venueAttendance: this event takes one event-wide answer',
    ]) {
      expect(sources).toContain(words);
    }
  });
});
