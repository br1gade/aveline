import { isApiError } from '@/api/errors';

export type ReviewRefusal =
  | { kind: 'moved'; isStale: true }
  | { kind: 'forbidden' | 'rateLimited' | 'successor'; isStale?: undefined }
  | { kind: 'noAnswer'; requestId: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId: string | undefined; isStale?: undefined };

/** The backend's words, which its statuses don't tell apart (`organization-reviews.service.ts`). */
const NOT_ADMIN = /Platform administrator review is required/;
const MOVED = /Review is already resolved|No such review/;
const SUCCESSOR = /An active successor is required|No active member in this organization/;

const MOVED_CODES: ReadonlySet<string | undefined> = new Set([
  'REVISION_CHANGED',
  // The organization closed meanwhile (`lockOrganizationStanding`).
  'ORGANIZATION_ACCESS_DENIED',
]);

/**
 * Why resolving was refused. Resolved meanwhile, a revision that changed, a review gone or an
 * organization closed underneath all mean the page is out of date: it reads again behind the words.
 */
export function reviewRefusalOf(error: unknown): ReviewRefusal {
  if (!isApiError(error)) throw error;
  const { status, code, messages, requestId } = error;
  const says = (words: RegExp) => messages.some((said) => words.test(said));
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 429) return { kind: 'rateLimited' };
  if (says(SUCCESSOR)) return { kind: 'successor' };
  if (says(NOT_ADMIN)) return { kind: 'forbidden' };
  if (says(MOVED) || MOVED_CODES.has(code)) {
    return { kind: 'moved', isStale: true };
  }
  if (status === 403) return { kind: 'forbidden' };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}
