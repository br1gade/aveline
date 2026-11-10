import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { refusalOf, type DoorAction, type DoorRefusal } from './refusals';

const refused = (status: number, message: string) =>
  new ApiError({ status, messages: [message], requestId: `r-${status}` });

const ARRIVED_AT = '2026-10-05T18:02:11.000Z';

/** A refusal with the backend's stable code and its `admission` facts (FR-76). */
const coded = (
  status: number,
  code: string,
  admission?: Record<string, unknown>,
  message = 'Words',
) =>
  new ApiError({
    status,
    messages: [message],
    requestId: `r-${status}`,
    feedback: {
      code,
      action: undefined,
      userMessage: undefined,
      details: [],
      ...(admission ? { admission } : {}),
    },
  });

const WHO = { guestId: 'g1', holderName: 'Armen Petrosyan' };
const LABELS = { en: 'The house rules', hy: 'Տան կանոնները' };

describe('a refusal by its code and facts (FR-76)', () => {
  it.each<[string, ApiError, DoorAction, DoorRefusal]>([
    [
      'a second arrival, with when and who',
      coded(409, 'ADMISSION_ALREADY_CHECKED_IN', { ...WHO, arrivedAt: ARRIVED_AT }),
      'checkIn',
      { kind: 'alreadyHere', arrivedAt: ARRIVED_AT, ...WHO },
    ],
    [
      'a used code, with when it was used and by whom',
      coded(400, 'TICKET_ALREADY_USED', { ...WHO, usedAt: ARRIVED_AT }),
      'admit',
      { kind: 'ticketUsed', usedAt: ARRIVED_AT, ...WHO },
    ],
    [
      'a used code whose time is the linked check-in’s',
      coded(400, 'TICKET_ALREADY_USED', { ...WHO, arrivedAt: ARRIVED_AT }),
      'admit',
      { kind: 'ticketUsed', usedAt: ARRIVED_AT, ...WHO },
    ],
    [
      'a used code with no facts',
      coded(400, 'TICKET_ALREADY_USED'),
      'admit',
      { kind: 'ticketUsed' },
    ],
    [
      'a linked guest’s second check-in, as already here',
      coded(400, 'TICKET_ALREADY_USED', { ...WHO, arrivedAt: ARRIVED_AT }),
      'checkIn',
      { kind: 'alreadyHere', arrivedAt: ARRIVED_AT, ...WHO },
    ],
    [
      'a cancelled order',
      coded(400, 'TICKET_ORDER_UNAVAILABLE', { orderStatus: 'CANCELLED' }),
      'admit',
      { kind: 'orderCancelled' },
    ],
    [
      'a refunded order',
      coded(400, 'TICKET_ORDER_UNAVAILABLE', { orderStatus: 'REFUNDED' }),
      'admit',
      { kind: 'orderRefunded' },
    ],
    [
      'an order never paid',
      coded(400, 'TICKET_ORDER_UNAVAILABLE', { orderStatus: 'EXPIRED' }),
      'admit',
      { kind: 'orderExpired' },
    ],
    [
      'an order being cancelled',
      coded(400, 'TICKET_ORDER_UNAVAILABLE', { orderStatus: 'PAID', isCancellationPending: true }),
      'admit',
      { kind: 'orderCancelling' },
    ],
    [
      'an order in a state it doesn’t know',
      coded(400, 'TICKET_ORDER_UNAVAILABLE', { orderStatus: 'SOMETHING_NEW' }),
      'admit',
      { kind: 'orderClosed' },
    ],
    [
      'a void ticket',
      coded(400, 'TICKET_STATUS_UNAVAILABLE', { ticketStatus: 'VOID' }),
      'admit',
      { kind: 'ticketVoid' },
    ],
    [
      'a refunded ticket',
      coded(400, 'TICKET_STATUS_UNAVAILABLE', { ticketStatus: 'REFUNDED' }),
      'admit',
      { kind: 'ticketRefunded' },
    ],
    [
      'a ticket that names nobody',
      coded(400, 'TICKET_ATTENDEE_REQUIRED'),
      'admit',
      { kind: 'registerFirst' },
    ],
    [
      'only that person’s missing agreements',
      coded(400, 'ADMISSION_ACKNOWLEDGEMENTS_REQUIRED', {
        ...WHO,
        missingAcknowledgements: [
          { questionId: 'q1', labels: LABELS },
          { questionId: 'q2', labels: { en: 'Photographs' } },
          { questionId: 42 },
        ],
      }),
      'checkIn',
      {
        kind: 'mustAgree',
        guestId: 'g1',
        questionId: 'q1',
        holderName: 'Armen Petrosyan',
        missing: [
          { questionId: 'q1', labels: LABELS },
          { questionId: 'q2', labels: { en: 'Photographs' } },
        ],
      },
    ],
    ['a changed link', coded(409, 'ADMISSION_LINK_CHANGED'), 'admit', { kind: 'linkChanged' }],
    [
      'an unknown code',
      coded(404, 'ADMISSION_TARGET_NOT_FOUND'),
      'admit',
      { kind: 'notRecognised' },
    ],
    [
      'an unknown guest',
      coded(404, 'ADMISSION_TARGET_NOT_FOUND'),
      'checkIn',
      { kind: 'guestGone' },
    ],
  ])('reads %s', (_case, error, action, refusal) => {
    expect(refusalOf(error, action)).toEqual(refusal);
  });

  it('trusts the code over the words', () => {
    const error = coded(
      409,
      'ADMISSION_LINK_CHANGED',
      undefined,
      'Guest was already checked in at x',
    );
    expect(refusalOf(error, 'checkIn')).toEqual({ kind: 'linkChanged' });
  });

  it('falls back to the words for a code it doesn’t know, or one without its facts', () => {
    expect(refusalOf(coded(400, 'BAD_REQUEST', undefined, 'Ticket already void'), 'admit')).toEqual(
      {
        kind: 'ticketVoid',
      },
    );
    const noGuest = coded(
      400,
      'ADMISSION_ACKNOWLEDGEMENTS_REQUIRED',
      { missingAcknowledgements: [] },
      'acknowledgements: g1 must acknowledge q1 in its current version',
    );
    expect(refusalOf(noGuest, 'checkIn')).toEqual({
      kind: 'mustAgree',
      guestId: 'g1',
      questionId: 'q1',
    });
  });

  it('drops a fact of the wrong kind rather than guessing', () => {
    const error = coded(409, 'ADMISSION_ALREADY_CHECKED_IN', { arrivedAt: 42, guestId: '' });
    expect(refusalOf(error, 'checkIn')).toEqual({ kind: 'alreadyHere', arrivedAt: null });
  });

  it('holds to the codes and facts the backend has', () => {
    const backend = (path: string) =>
      readFileSync(join(import.meta.dirname, '../../../../backend/src', path), 'utf8');
    const codes = backend('common/domain-http.exception.ts');
    for (const code of [
      'ADMISSION_TARGET_NOT_FOUND',
      'ADMISSION_LINK_CHANGED',
      'ADMISSION_ALREADY_CHECKED_IN',
      'ADMISSION_ACKNOWLEDGEMENTS_REQUIRED',
      'TICKET_ALREADY_USED',
      'TICKET_ORDER_UNAVAILABLE',
      'TICKET_STATUS_UNAVAILABLE',
      'TICKET_ATTENDEE_REQUIRED',
    ]) {
      expect(codes).toContain(`${code}: {`);
    }
    const facts = backend('common/feedback.dto.ts');
    for (const field of [
      'guestId?:',
      'holderName?:',
      'arrivedAt?:',
      'usedAt?:',
      'orderStatus?:',
      'isCancellationPending?:',
      'ticketStatus?:',
      'missingAcknowledgements?:',
    ]) {
      expect(facts).toContain(field);
    }
    expect(backend('common/filters/all-exceptions.filter.ts')).toContain('admission:');
  });
});

describe('a check-in refused', () => {
  it.each([
    [
      refused(409, `Guest was already checked in at ${ARRIVED_AT}`),
      { kind: 'alreadyHere', arrivedAt: ARRIVED_AT },
    ],
    // A ticket-linked guest's second check-in: a 400, with no time.
    [refused(400, 'Ticket already used'), { kind: 'alreadyHere', arrivedAt: null }],
    [refused(400, 'Ticket already void'), { kind: 'ticketVoid' }],
    [refused(400, 'Ticket already refunded'), { kind: 'ticketRefunded' }],
    [
      refused(400, 'Ticket order is cancelled or cancellation is in progress'),
      { kind: 'orderClosed' },
    ],
    [
      refused(400, 'acknowledgements: g1 must acknowledge q1 in its current version'),
      { kind: 'mustAgree', guestId: 'g1', questionId: 'q1' },
    ],
    [refused(404, 'That guest is not on this event'), { kind: 'guestGone' }],
  ])('reads %s', (error, refusal) => {
    expect(refusalOf(error, 'checkIn')).toEqual(refusal);
  });

  it.each([
    'Ticket was linked; refresh and scan again',
    'Ticket was linked to another guest; refresh',
  ])('never reads the 409 "%s" as already here', (sentence) => {
    expect(refusalOf(refused(409, sentence), 'checkIn')).toEqual({ kind: 'linkChanged' });
  });

  it('shows a 409 it does not know as it came, not as already here', () => {
    expect(refusalOf(refused(409, 'Something new'), 'checkIn')).toEqual({
      kind: 'other',
      sentence: 'Something new',
      requestId: 'r-409',
    });
  });
});

describe('a ticket code refused', () => {
  it.each([
    [refused(400, 'Ticket already used'), { kind: 'ticketUsed' }],
    [refused(400, 'Ticket already void'), { kind: 'ticketVoid' }],
    [refused(400, 'Ticket already refunded'), { kind: 'ticketRefunded' }],
    [
      refused(400, 'Ticket order is cancelled or cancellation is in progress'),
      { kind: 'orderClosed' },
    ],
    [refused(404, 'Ticket not recognised'), { kind: 'notRecognised' }],
    [
      refused(
        400,
        'acknowledgements: register the ticket attendee and collect their acknowledgement before check-in',
      ),
      { kind: 'registerFirst' },
    ],
    [
      refused(409, `Guest was already checked in at ${ARRIVED_AT}`),
      { kind: 'alreadyHere', arrivedAt: ARRIVED_AT },
    ],
    [refused(409, 'Ticket was linked to another guest; refresh'), { kind: 'linkChanged' }],
  ])('reads %s', (error, refusal) => {
    expect(refusalOf(error, 'admit')).toEqual(refusal);
  });
});

describe('an undo refused', () => {
  it.each([
    [refused(404, 'That guest is not checked in'), { kind: 'notCheckedIn' }],
    [refused(404, 'That guest is not on this event'), { kind: 'guestGone' }],
    [refused(409, 'Ticket was linked; refresh and undo again'), { kind: 'linkChanged' }],
  ])('reads %s', (error, refusal) => {
    expect(refusalOf(error, 'undo')).toEqual(refusal);
  });
});

describe('what any door call can answer', () => {
  it.each<DoorAction>(['checkIn', 'admit', 'undo'])('%s words its status', (action) => {
    expect(refusalOf(refused(403, 'Forbidden'), action)).toEqual({ kind: 'forbidden' });
    expect(refusalOf(refused(429, 'Too Many Requests'), action)).toEqual({ kind: 'rateLimited' });
    expect(refusalOf(refused(500, 'Internal'), action)).toEqual({
      kind: 'noAnswer',
      requestId: 'r-500',
    });
    expect(refusalOf(networkError('r0'), action)).toEqual({ kind: 'noAnswer', requestId: 'r0' });
    expect(refusalOf(new Error('anything else'), action)).toEqual({ kind: 'noAnswer' });
  });
});

/** A stand-in until FR-76: if the backend rewords one of these, the door must not misread it. */
describe('the sentences recognised are the backend’s own', () => {
  // Read only, as route-paths.test.ts does.
  const source = join(import.meta.dirname, '..', '..', '..', '..', 'backend', 'src');
  const backend = (path: string) => readFileSync(join(source, path), 'utf8');

  it('are still in its sources', () => {
    const admission = backend('modules/guests/admission.ts');
    for (const words of [
      'Ticket order is cancelled or cancellation is in progress',
      'Ticket already ${ticket.status.toLowerCase()}',
      'Guest was already checked in at ${existing.arrivedAt.toISOString()}',
      'Ticket was linked; refresh and scan again',
      'Ticket was linked to another guest; refresh',
      'Ticket was linked; refresh and undo again',
      'That guest is not on this event',
      'That guest is not checked in',
      'acknowledgements: register the ticket attendee and collect their acknowledgement before check-in',
    ]) {
      expect(admission).toContain(words);
    }
    expect(backend('modules/ticketing/ticketing.service.ts')).toContain('Ticket not recognised');
    expect(backend('modules/guest-contributions/acknowledgement-writes.ts')).toContain(
      'acknowledgements: ${missing[0].guestId} must acknowledge ${missing[0].questionId} in its current version',
    );
  });
});
