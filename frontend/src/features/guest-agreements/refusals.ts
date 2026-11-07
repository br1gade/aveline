import { isApiError } from '@/api/errors';

/**
 * Why an agreement was not recorded (docs/API.md §11), by status: an old wording (409) is read
 * again and asked again; a link that no longer opens (404) offers nothing; a refused agreement
 * (400, such as a drawing not ready) keeps the backend's sentence, marked English (FR-28).
 */
export type AgreementRefusal =
  | { kind: 'reworded' }
  | { kind: 'gone' }
  | { kind: 'refused'; sentence: string }
  | { kind: 'rateLimited' }
  | { kind: 'failed'; requestId?: string | undefined };

export function agreementRefusal(error: unknown): AgreementRefusal {
  if (!isApiError(error)) return { kind: 'failed' };
  if (error.status === 409) return { kind: 'reworded' };
  if (error.status === 404) return { kind: 'gone' };
  if (error.status === 429) return { kind: 'rateLimited' };
  if (error.status === 400) return { kind: 'refused', sentence: error.messages[0] ?? '' };
  return { kind: 'failed', requestId: error.requestId };
}
