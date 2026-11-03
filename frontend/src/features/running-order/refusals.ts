import { isApiError } from '@/api/errors';

/**
 * Why a running-order write was refused (docs/API.md §6). The backend's 400s, 404s and 409s are
 * English sentences under one code per status, so **a temporary stand-in (design PD-107)**
 * recognises each by its exact words, under a test that reads the source, and anything else is
 * shown as it came, marked English. Deleted when FR-28 gives codes.
 */
type SentenceKind = 'venueKept' | 'venueGone' | 'entryGone' | 'labelRefused';

export type EntryRefusal =
  | { kind: SentenceKind | 'gone'; isStale: boolean }
  | { kind: 'forbidden' | 'rateLimited'; isStale?: undefined }
  | { kind: 'noAnswer'; requestId?: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined; isStale?: undefined };

/** `isStale`: the list isn't what the page shows, so it reloads behind the words. */
export const SENTENCES: ReadonlyArray<readonly [string, SentenceKind, boolean]> = [
  [
    'venue: attendance, checkout choices or seats exist; keep the venue guest-facing to preserve history',
    'venueKept',
    false,
  ],
  ['That venue is not on this event', 'venueGone', true],
  ['No such timeline entry on this event', 'entryGone', true],
  ['label: give the entry a name in at least one language', 'labelRefused', false],
];

function refusedSentence(
  status: number,
  messages: readonly string[],
  requestId: string | undefined,
): EntryRefusal {
  const known = SENTENCES.find(([words]) => messages.includes(words));
  if (known) return { kind: known[1], isStale: known[2] };
  if (status === 404) return { kind: 'gone', isStale: true };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}

export function refusalOf(error: unknown): EntryRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rateLimited' };
  return refusedSentence(status, messages, requestId);
}
