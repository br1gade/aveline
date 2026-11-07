import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { refusalOf, type DoorAction } from './refusals';

const refused = (status: number, message: string) =>
  new ApiError({ status, messages: [message], requestId: `r-${status}` });

const ARRIVED_AT = '2026-10-05T18:02:11.000Z';

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
