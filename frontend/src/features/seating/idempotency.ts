import { isApiError } from '@/api/errors';

/** The key a start carries, and what to do with it once the press is answered. */
export interface RetryKey {
  /** The key to send: the last one, while a press is still unanswered; otherwise a new one. */
  next: () => string;
  /** After a press: `null` when it went through, or what it failed with. */
  settle: (error: unknown) => void;
}

/**
 * Automatic seating is started with a client UUID, which the backend treats as one request however
 * often it arrives (docs/API.md §6). A press that got no answer may have queued a run, so the next
 * press sends the same key and gets that run back; any answer, a refusal included, ends the key.
 * PD-53's retry id works the same way.
 */
export function createRetryKey(make: () => string = () => crypto.randomUUID()): RetryKey {
  let pending: string | null = null;
  return {
    next: () => {
      pending ??= make();
      return pending;
    },
    settle: (error) => {
      const isUnanswered = error !== null && (!isApiError(error) || error.status === 0);
      if (!isUnanswered) pending = null;
    },
  };
}
