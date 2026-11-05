import { isApiError } from '@/api/errors';

export type RequestRefusal =
  | { kind: 'moved'; isStale: true }
  | { kind: 'forbidden' | 'rateLimited'; isStale?: undefined }
  | { kind: 'noAnswer'; requestId: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId: string | undefined; isStale?: undefined };

/** The words the backend refuses a move in (`request-status.ts`, `privacy.service.ts`). */
const MOVED = /cannot become|is completed by carrying|must be IN_PROGRESS|is applied by editing/;

/** Someone else got there first, or the page is out of date: it reads again behind the words. */
export function requestRefusalOf(error: unknown): RequestRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rateLimited' };
  if (status === 404 || status === 409 || messages.some((said) => MOVED.test(said))) {
    return { kind: 'moved', isStale: true };
  }
  return { kind: 'other', sentence: messages.join(' '), requestId };
}
