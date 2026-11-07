import { isApiError } from '@/api/errors';

export type CustomerRefusal =
  | {
      kind: 'needsChoice' | 'forbidden' | 'rateLimited' | 'emailRefused' | 'nameRefused' | 'gone';
    }
  | { kind: 'noAnswer'; requestId: string | undefined }
  | { kind: 'other'; sentence: string; requestId: string | undefined };

/**
 * Why opening an account was refused. A field's 400 starts with its name (FR-20). A chosen organization
 * that is no longer the address's answers `ORGANIZATION_ACCESS_DENIED`, a 403 that isn't about staff.
 */
export function customerRefusalOf(error: unknown): CustomerRefusal {
  if (!isApiError(error)) throw error;
  const { status, code, messages, requestId } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (code === 'ORGANIZATION_SELECTION_REQUIRED') return { kind: 'needsChoice' };
  if (code === 'ORGANIZATION_ACCESS_DENIED') return { kind: 'gone' };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rateLimited' };
  if (messages.some((said) => /^ownerEmail\b/.test(said))) return { kind: 'emailRefused' };
  if (messages.some((said) => /^name\b/.test(said))) return { kind: 'nameRefused' };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}
