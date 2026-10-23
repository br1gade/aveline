import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { classifySendError } from './server-errors';

const PEOPLE = { memberIds: ['g2', 'g3'], partyFirstNames: ['Narek'] };

function refused(...messages: string[]) {
  return classifySendError(new ApiError({ status: 400, messages, requestId: 'req-1' }), PEOPLE);
}

describe('classifySendError', () => {
  it('maps a refusal naming a person onto that person’s own fields', () => {
    expect(
      refused(
        'members: g3 must answer q-main, as they are coming',
        'members: g2 answers: q-multi must be a list of positions of its options',
        'party: Narek must answer q-main, as they are coming',
        'party: narek answers: q-note must be text',
      ),
    ).toEqual({
      kind: 'invalid',
      hasOther: false,
      fields: [
        { field: 'members.1.answers.q-main', code: 'required' },
        { field: 'members.0.answers.q-multi', code: 'invalidAnswer' },
        { field: 'party.0.answers.q-main', code: 'required' },
        { field: 'party.0.answers.q-note', code: 'invalidAnswer' },
      ],
    });
  });

  it('falls back to the section when the person is not on the form, or the problem is general', () => {
    expect(
      refused(
        'members: g9 must answer q-main, as they are coming',
        'members: g9 is not in this household',
        'party: Ani dietary: choose from vegetarian, vegan',
        'This invitation allows 3 guest(s); 2 already named and 2 more were submitted',
      ),
    ).toMatchObject({
      fields: [
        { field: 'members', code: 'members' },
        { field: 'members', code: 'members' },
        { field: 'party', code: 'party' },
        { field: 'party', code: 'seats' },
      ],
    });
  });

  it('maps the respondent’s answers and built-in questions, and counts what names no field', () => {
    expect(
      refused(
        'answers: q-main is required for a guest who is coming',
        'drinkPreference: this invitation does not ask for it',
        'locale: this invitation is in hy, en, not "fr"',
      ),
    ).toEqual({
      kind: 'invalid',
      hasOther: true,
      fields: [
        { field: 'answers.q-main', code: 'required' },
        { field: 'drinkPreference', code: 'invalidAnswer' },
      ],
    });
  });

  it.each(['This invitation has closed', 'This invitation is not accepting responses'])(
    'treats “%s” as closed while sending',
    (message) => {
      expect(refused(message)).toEqual({ kind: 'closed' });
    },
  );

  it('separates too many requests from a failure, and keeps the reference', () => {
    expect(classifySendError(new ApiError({ status: 429, messages: [] }), PEOPLE)).toEqual({
      kind: 'rate-limited',
    });
    expect(
      classifySendError(new ApiError({ status: 503, messages: [], requestId: 'req-2' }), PEOPLE),
    ).toEqual({
      kind: 'failed',
      requestId: 'req-2',
    });
    expect(classifySendError(networkError('req-3'), PEOPLE)).toEqual({
      kind: 'failed',
      requestId: 'req-3',
    });
  });
});
