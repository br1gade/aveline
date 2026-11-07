import { isApiError, type ApiError } from '@/api/errors';

/**
 * Why the door refused someone (docs/API.md §6). The backend gives English sentences under generic
 * codes, and a status does not decide them: a 409 can mean "already here" or "the ticket's link
 * changed", and a linked guest's second check-in is a 400. So **a temporary stand-in** recognises
 * each by its exact words (`guests/admission.ts`, `ticketing.service.ts`,
 * `acknowledgement-writes.ts`), and anything else is shown as it came, marked English. Deleted when
 * FR-76 gives codes.
 */
export type DoorAction = 'checkIn' | 'admit' | 'undo';

export type DoorRefusal =
  | { kind: 'alreadyHere'; arrivedAt: string | null }
  | { kind: 'mustAgree'; guestId: string; questionId: string }
  | {
      kind:
        | 'ticketUsed'
        | 'ticketVoid'
        | 'ticketRefunded'
        /** Cancelled, refunded, expired or being cancelled: one sentence for all (FR-76). */
        | 'orderClosed'
        | 'registerFirst'
        | 'linkChanged'
        | 'notRecognised'
        | 'guestGone'
        | 'notCheckedIn'
        | 'forbidden'
        | 'rateLimited';
    }
  | { kind: 'noAnswer'; requestId?: string | undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined };

const SENTENCES: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => DoorRefusal]> = [
  [
    /^Guest was already checked in at (\S+)$/,
    (match) => ({ kind: 'alreadyHere', arrivedAt: match[1] ?? null }),
  ],
  [
    /^acknowledgements: (\S+) must acknowledge (\S+) in its current version$/,
    (match) => ({ kind: 'mustAgree', guestId: match[1] ?? '', questionId: match[2] ?? '' }),
  ],
  [/^acknowledgements: register the ticket attendee/, () => ({ kind: 'registerFirst' })],
  [/^Ticket already void$/, () => ({ kind: 'ticketVoid' })],
  [/^Ticket already refunded$/, () => ({ kind: 'ticketRefunded' })],
  [/^Ticket order is cancelled or cancellation is in progress$/, () => ({ kind: 'orderClosed' })],
  [/^Ticket was linked/, () => ({ kind: 'linkChanged' })],
  [/^That guest is not on this event$/, () => ({ kind: 'guestGone' })],
  [/^That guest is not checked in$/, () => ({ kind: 'notCheckedIn' })],
];

function byStatus(error: ApiError): DoorRefusal | null {
  if (error.status === 0 || error.status >= 500)
    return { kind: 'noAnswer', requestId: error.requestId };
  if (error.status === 429) return { kind: 'rateLimited' };
  return error.status === 403 ? { kind: 'forbidden' } : null;
}

function bySentence(sentence: string, action: DoorAction): DoorRefusal | null {
  // The same words mean different things: a person's second arrival, or a code used before.
  if (sentence === 'Ticket already used')
    return action === 'admit' ? { kind: 'ticketUsed' } : { kind: 'alreadyHere', arrivedAt: null };
  for (const [pattern, refusal] of SENTENCES) {
    const match = pattern.exec(sentence);
    if (match) return refusal(match);
  }
  return null;
}

export function refusalOf(error: unknown, action: DoorAction): DoorRefusal {
  if (!isApiError(error)) return { kind: 'noAnswer' };
  const sentence = error.messages[0] ?? '';
  const known = byStatus(error) ?? bySentence(sentence, action);
  if (known) return known;
  if (error.status === 404) return { kind: action === 'admit' ? 'notRecognised' : 'guestGone' };
  return { kind: 'other', sentence, requestId: error.requestId };
}

/** Whether what the door shows is out of date, so the guest list is read again. */
export function isListStale(refusal: DoorRefusal): boolean {
  return (
    refusal.kind === 'linkChanged' ||
    refusal.kind === 'guestGone' ||
    refusal.kind === 'notCheckedIn' ||
    (refusal.kind === 'alreadyHere' && refusal.arrivedAt === null)
  );
}
