import { isApiError } from '@/api/errors';

export type RequestRefusal =
  | { kind: 'moved'; isStale: true }
  /** Someone applied the erasure first, so it can't be rejected (FR-131). */
  | { kind: 'erasureApplied'; isStale: true }
  /** A newer export was made meanwhile; that one's delivery is confirmed instead (FR-128). */
  | { kind: 'newerExport'; isStale: true }
  | { kind: 'forbidden' | 'rateLimited'; isStale?: undefined }
  | { kind: 'noAnswer'; requestId: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId: string | undefined; isStale?: undefined };

/**
 * The backend's words, by what they mean (`request-status.ts`, `privacy.service.ts`): someone else
 * applied the erasure first (FR-131), a newer export was made (FR-128), or the request moved on.
 */
const BY_WORDS: ReadonlyArray<readonly [RegExp, RequestRefusal]> = [
  [/^status: an applied erasure cannot be rejected/, { kind: 'erasureApplied', isStale: true }],
  [/^Only the latest export generation can be confirmed/, { kind: 'newerExport', isStale: true }],
  [
    /cannot become|is completed by carrying|must be IN_PROGRESS|is applied by editing/,
    { kind: 'moved', isStale: true },
  ],
];

function byWords(messages: readonly string[]): RequestRefusal | null {
  const found = BY_WORDS.find(([words]) => messages.some((said) => words.test(said)));
  return found ? found[1] : null;
}

/** Someone else got there first, or the page is out of date: it reads again behind the words. */
export function requestRefusalOf(error: unknown): RequestRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rateLimited' };
  const known = byWords(messages);
  if (known) return known;
  if (status === 404 || status === 409) return { kind: 'moved', isStale: true };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}
