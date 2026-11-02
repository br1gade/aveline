import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { cancelRefusal, reconcileRefusal } from './refusals';

const refused = (status: number, message: string, code?: string) =>
  new ApiError({
    status,
    messages: [message],
    requestId: `r-${status}`,
    feedback: { code, action: undefined, userMessage: undefined, details: [] },
  });

describe('a cancellation refused', () => {
  it.each([
    [
      refused(
        409,
        '1 ticket(s) on this order were already admitted at the door, so it cannot be cancelled',
      ),
      'admitted',
    ],
    [refused(400, 'This order is reserved, not paid, so there is nothing to cancel'), 'notPaid'],
    [refused(403, 'Forbidden'), 'forbidden'],
    [refused(404, 'No such order on this event'), 'gone'],
    [refused(502, 'Refund outcome unknown'), 'bankUnknown'],
    [refused(429, 'Too Many Requests'), 'rateLimited'],
    [refused(500, 'Internal'), 'noAnswer'],
    [networkError('r0'), 'noAnswer'],
  ])('%#: reads as %s', (error, kind) => {
    expect(cancelRefusal(error).kind).toBe(kind);
  });
});

describe('a reconciliation refused, by its exact words until FR-28', () => {
  it.each([
    ['Ticket guest changed; review the current link', 'changed'],
    ['Guest already has a ticket', 'hasTicket'],
    ['An erased guest cannot be linked', 'erased'],
    ['An erased attendee cannot be linked', 'erased'],
    ['An invited guest cannot be replaced by another person', 'invited'],
    [
      'Checkout guest has seats, admission, a signature or communication history; resolve those before linking',
      'history',
    ],
    ['Used legacy ticket has no admission timestamp; staff review is required', 'staffReview'],
    ['Two admission records disagree; staff review is required', 'staffReview'],
    ['Attendance history is too large for automatic reconciliation', 'staffReview'],
    ['Only active paid tickets may be reconciled', 'notActive'],
    ['Ticket already has an attendee; use the explicit link flow', 'hasAttendee'],
  ])('409 %j reads as %s', (message, kind) => {
    expect(reconcileRefusal(refused(409, message)).kind).toBe(kind);
  });

  it('reads a changed policy, a forbidden role, a ticket gone and an unknown sentence', () => {
    expect(
      reconcileRefusal(
        refused(409, 'attendanceRevision: attendance policy changed', 'ATTENDANCE_CHANGED'),
      ).kind,
    ).toBe('staleRevision');
    expect(reconcileRefusal(refused(403, 'Forbidden')).kind).toBe('forbidden');
    expect(reconcileRefusal(refused(404, 'Ticket not found on this event')).kind).toBe('gone');
    expect(reconcileRefusal(refused(400, 'attendees: answer q-meal is required'))).toEqual({
      kind: 'other',
      sentence: 'attendees: answer q-meal is required',
      requestId: 'r-400',
    });
  });
});
