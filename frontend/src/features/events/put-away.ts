import { isApiError } from '@/api/errors';

import type { EventDetail, EventStatus } from './types';

/** What the event was before it was put away, which decides whether it may be deleted. */
function liveStatus(event: Pick<EventDetail, 'status' | 'statusBeforeArchive'>) {
  return event.status === 'ARCHIVED' ? event.statusBeforeArchive : event.status;
}

/**
 * Whether to offer deleting (design PD-112). The backend deletes only an event that was never
 * published (`assertDeletable`); money that moved through one is refused when pressed, as the
 * detail doesn't say. A status this page doesn't know is offered, and the server decides.
 */
export function isDeletable(event: Pick<EventDetail, 'status' | 'statusBeforeArchive'>): boolean {
  const status: EventStatus | null | undefined = liveStatus(event);
  return status === undefined || status === null || status === 'DRAFT';
}

export function isArchived(event: Pick<EventDetail, 'status'>): boolean {
  return event.status === 'ARCHIVED';
}

/**
 * The backend's sentence for a write an archived event refuses (`event-lock.ts`,
 * `publishing.service.ts`): publishing, reopening, designing. Recognised by its words (FR-28).
 */
export const ARCHIVED_SENTENCE =
  'This event is archived; bring it back with POST /events/:id/unarchive first';

type SentenceKind = 'published' | 'moneyMoved' | 'notArchived';

export type PutAwayRefusal =
  | { kind: SentenceKind | 'gone'; isStale: true }
  | { kind: 'forbidden' | 'rateLimited'; isStale?: undefined }
  | { kind: 'noAnswer'; requestId?: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined; isStale?: undefined };

/**
 * Why archiving, bringing back or deleting was refused (docs/API.md §6). **A temporary stand-in
 * (design PD-112):** the 409s and the 400 are told apart by their exact words, under a test that
 * reads the source; each means the page is out of date, so it reloads behind them. Deleted when
 * FR-28 gives codes.
 */
export const SENTENCES: ReadonlyArray<readonly [string, SentenceKind]> = [
  [
    'This event was published, so guests may hold its invitation; archive it instead with POST /events/:id/archive',
    'published',
  ],
  [
    'Money has moved through this event, and those records are kept; archive it instead',
    'moneyMoved',
  ],
  ['This event is not archived', 'notArchived'],
];

export function putAwayRefusalOf(error: unknown): PutAwayRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rateLimited' };
  const known = SENTENCES.find(([words]) => messages.includes(words));
  if (known) return { kind: known[1], isStale: true };
  if (status === 404) return { kind: 'gone', isStale: true };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}
