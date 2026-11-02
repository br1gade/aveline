import { isApiError, type ApiError } from '@/api/errors';

/**
 * Why a cancellation or a reconciliation was refused (docs/API.md §5). The backend gives English
 * sentences under generic codes, so **a temporary stand-in** recognises the ones it has by their
 * exact words (`ticket-cancellation.service.ts`, `ticket-link.ts`, `ticket-attendees.service.ts`);
 * anything else is shown as it came, marked English. Deleted when FR-28 gives codes.
 */
export type CancelRefusal =
  | { kind: 'admitted' | 'notPaid' | 'forbidden' | 'gone' | 'bankUnknown' | 'rateLimited' }
  | { kind: 'noAnswer'; requestId?: string | undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined };

function cancelByStatus(error: ApiError): CancelRefusal | null {
  if (error.status === 502) return { kind: 'bankUnknown' };
  if (error.status === 0 || error.status >= 500)
    return { kind: 'noAnswer', requestId: error.requestId };
  if (error.status === 429) return { kind: 'rateLimited' };
  if (error.status === 403) return { kind: 'forbidden' };
  return error.status === 404 ? { kind: 'gone' } : null;
}

export function cancelRefusal(error: unknown): CancelRefusal {
  if (!isApiError(error)) return { kind: 'noAnswer' };
  const refusal = cancelByStatus(error);
  if (refusal) return refusal;
  const sentence = error.messages[0] ?? '';
  if (/already admitted at the door/.test(sentence)) return { kind: 'admitted' };
  if (/not paid, so there is nothing to cancel$/.test(sentence)) return { kind: 'notPaid' };
  return { kind: 'other', sentence, requestId: error.requestId };
}

type ReconcileKind =
  | 'changed'
  | 'hasTicket'
  | 'erased'
  | 'invited'
  | 'history'
  | 'staffReview'
  | 'notActive'
  | 'hasAttendee';

export type ReconcileRefusal =
  | { kind: ReconcileKind | 'staleRevision' | 'forbidden' | 'gone' | 'rateLimited' }
  | { kind: 'noAnswer'; requestId?: string | undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined };

const SENTENCES: ReadonlyArray<readonly [RegExp, ReconcileKind]> = [
  [/^Ticket guest changed; review the current link$/, 'changed'],
  [/^Guest already has a ticket$/, 'hasTicket'],
  [/^An erased (guest|attendee) cannot be linked$/, 'erased'],
  [/^An invited guest cannot be replaced by another person$/, 'invited'],
  [/^Checkout guest has seats, admission, a signature or communication history/, 'history'],
  [/staff review is required$|^Attendance history is too large/, 'staffReview'],
  [/^Only active paid tickets may be reconciled$/, 'notActive'],
  [/^Ticket already has an attendee; use the explicit link flow$/, 'hasAttendee'],
];

function byStatus(error: ApiError): ReconcileRefusal | null {
  if (error.status === 0 || error.status >= 500)
    return { kind: 'noAnswer', requestId: error.requestId };
  if (error.status === 429) return { kind: 'rateLimited' };
  if (error.status === 403) return { kind: 'forbidden' };
  if (error.status === 404) return { kind: 'gone' };
  return error.code === 'ATTENDANCE_CHANGED' ? { kind: 'staleRevision' } : null;
}

export function reconcileRefusal(error: unknown): ReconcileRefusal {
  if (!isApiError(error)) return { kind: 'noAnswer' };
  const refusal = byStatus(error);
  if (refusal) return refusal;
  const sentence = error.messages[0] ?? '';
  const known = SENTENCES.find(([pattern]) => pattern.test(sentence));
  return known ? { kind: known[1] } : { kind: 'other', sentence, requestId: error.requestId };
}
