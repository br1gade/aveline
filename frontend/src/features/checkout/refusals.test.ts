import { describe, expect, it } from 'vitest';

import { ApiError, networkError, type FieldFeedback } from '@/api/errors';

import { checkoutRefusal, formPath } from './refusals';

function refused(
  status: number,
  message: string | string[],
  extra: { code?: string; details?: FieldFeedback[] } = {},
) {
  const messages = Array.isArray(message) ? message : [message];
  return new ApiError({
    status,
    messages,
    requestId: `r-${status}`,
    feedback: {
      code: extra.code,
      action: undefined,
      userMessage: undefined,
      details: extra.details ?? [],
    },
  });
}

describe('checkout refusals, told apart until FR-63 gives codes', () => {
  it.each([
    [
      refused(
        409,
        'attendanceRevision: attendance policy changed; reload the invitation and reconfirm',
        { code: 'ATTENDANCE_CHANGED' },
      ),
      'staleRevision',
    ],
    [
      refused(409, 'idempotencyKey: already used for another checkout intent', {
        details: [{ field: 'idempotencyKey', code: 'CONFLICT', userMessage: '' }],
      }),
      'changedIntent',
    ],
    [refused(409, 'Only 2 ticket(s) remain; 3 were requested'), 'soldOut'],
    [refused(409, 'This ticket type is not on sale'), 'notOnSale'],
    [refused(400, 'This ticket type is not on sale'), 'notOnSale'],
    [refused(400, 'Ticket sales closed when this event started'), 'salesClosed'],
    [refused(400, 'Sales have closed for this ticket type'), 'salesClosed'],
    [refused(400, 'Sales have not opened for this ticket type'), 'salesNotOpen'],
    [refused(400, 'At least 2 ticket(s) per order'), 'orderLimits'],
    [refused(400, 'At most 4 ticket(s) per order'), 'orderLimits'],
    [refused(404, 'No published event at "autumn-jazz-night"'), 'notFound'],
    [refused(404, 'One or more ticket types do not belong to this event'), 'notFound'],
    [refused(403, 'Payments are disabled for the free pilot'), 'paymentsOff'],
    [refused(429, 'Too Many Requests'), 'rateLimited'],
    [networkError('r-0'), 'noAnswer'],
    [refused(502, 'Bad Gateway'), 'noAnswer'],
    [refused(500, 'Internal server error'), 'noAnswer'],
  ])('%#: reads as %s', (error, kind) => {
    expect(checkoutRefusal(error).kind).toBe(kind);
  });

  it.each([
    ['We do not recognise that code', 'unknown'],
    ['This code is no longer available', 'unavailable'],
    ['This code does not apply to this event', 'otherEvent'],
    ['This code is not valid yet', 'notYet'],
    ['This code has expired', 'expired'],
    ['This code has run out', 'ranOut'],
  ])('a promo code refused at checkout: %j', (sentence, reason) => {
    expect(checkoutRefusal(refused(400, sentence))).toEqual({ kind: 'promo', reason });
  });

  it('a promo code that ran out between the check and the order', () => {
    expect(checkoutRefusal(refused(409, 'This code has just run out'))).toEqual({
      kind: 'promo',
      reason: 'ranOut',
    });
  });

  it("a promo code's minimum order keeps its amount", () => {
    expect(checkoutRefusal(refused(400, 'This code needs an order of at least 20000'))).toEqual({
      kind: 'promo',
      reason: 'minimum',
      minimumMinor: '20000',
    });
  });

  it('a required answer the backend names, without saying whose', () => {
    expect(checkoutRefusal(refused(400, 'attendees: answer q-meal is required'))).toEqual({
      kind: 'requiredAnswer',
      questionId: 'q-meal',
    });
  });

  it("puts each refused field on the form's own field", () => {
    const refusal = checkoutRefusal(
      refused(400, ['buyerEmail must be an email', 'attendees.2.email must be an email'], {
        details: [
          { field: 'buyerEmail', code: 'VALIDATION_FAILED', userMessage: '' },
          { field: 'attendees.2.email', code: 'VALIDATION_FAILED', userMessage: '' },
        ],
      }),
    );
    expect(refusal).toEqual({ kind: 'fields', paths: ['buyerEmail', 'people.2.email'] });
  });

  it('keeps an unknown sentence as it came, with its reference', () => {
    expect(
      checkoutRefusal(refused(400, 'attendees.locale: use one of the event languages')),
    ).toEqual({
      kind: 'other',
      sentence: 'attendees.locale: use one of the event languages',
      requestId: 'r-400',
    });
    expect(checkoutRefusal(new Error('boom'))).toMatchObject({ kind: 'noAnswer' });
  });
});

describe("the form's path for a refused field", () => {
  it.each([
    ['buyerName', 'buyerFirstName'],
    ['buyerEmail', 'buyerEmail'],
    ['buyerPhone', 'buyerPhone'],
    ['attendees.0.firstName', 'people.0.firstName'],
    ['attendees.3.lastName', 'people.3.lastName'],
    ['attendees.1.phone', 'people.1.phone'],
    ['attendees.1.drinkPreference', 'people.1.drink'],
    ['attendees.1.dietaryNotes', 'people.1.dietaryNotes'],
    ['attendees.4.venueAttendance', 'people.4.venues'],
    ['attendees.4.answers.0.value', 'people.4.answers'],
    ['attendees.locale', null],
    ['items', null],
  ])('%s → %s', (field, path) => {
    expect(formPath(field)).toBe(path);
  });
});
