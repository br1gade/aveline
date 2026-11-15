import { isApiError } from '@/api/errors';

/**
 * Why a change to Aveline's staff was refused (docs/API.md, "Aveline staff accounts"). The API
 * answers with codes, so nothing reads its sentences. A stale refusal reads the page again behind
 * the words: the admin is one no longer, or the list changed underneath.
 */
export type StaffRefusal =
  | { kind: 'forbidden' | 'selfChange' | 'gone'; isStale: true }
  | {
      kind: 'notFound' | 'unverified' | 'emailRefused' | 'rateLimited';
      isStale: undefined;
    }
  | { kind: 'noAnswer'; requestId: string | undefined; isStale: undefined }
  | { kind: 'other'; sentence: string; requestId: string | undefined; isStale: undefined };

/** The refusals that belong under the address, in the form. */
export type StaffFieldRefusal = 'notFound' | 'unverified' | 'emailRefused';

const CODES: Readonly<Record<string, StaffRefusal>> = {
  STAFF_ACCOUNT_NOT_FOUND: { kind: 'notFound', isStale: undefined },
  STAFF_EMAIL_UNVERIFIED: { kind: 'unverified', isStale: undefined },
  // The page never offers it: another tab, or a role read before it changed.
  STAFF_SELF_CHANGE: { kind: 'selfChange', isStale: true },
};

export function staffRefusalOf(error: unknown): StaffRefusal {
  if (!isApiError(error)) throw error;
  const { status, code, messages, requestId } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId, isStale: undefined };
  if (status === 429) return { kind: 'rateLimited', isStale: undefined };
  const known = code ? CODES[code] : undefined;
  if (known) return known;
  if (status === 403) return { kind: 'forbidden', isStale: true };
  // class-validator starts with the property (FR-20); the address is the form's one typed field.
  if (messages.some((message) => /^email\b/.test(message))) {
    return { kind: 'emailRefused', isStale: undefined };
  }
  return { kind: 'other', sentence: messages.join(' '), requestId, isStale: undefined };
}

/** Removing someone who is no longer there means the list is out of date. */
export function revokeRefusalOf(error: unknown): StaffRefusal {
  const refusal = staffRefusalOf(error);
  return refusal.kind === 'notFound' ? { kind: 'gone', isStale: true } : refusal;
}
