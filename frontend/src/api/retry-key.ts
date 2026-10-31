import { isApiError } from './errors';

/** The key a request carries, and what to do with it once the press is answered. */
export interface RetryKey {
  /**
   * The key to send: the last one, while a press with the same intent is still unanswered;
   * otherwise a new one. The intent names what the press asks for, when the page offers choices.
   */
  next: (intent?: string) => string;
  /** Whether the next press with this intent would send a key that was already sent once. */
  isPending: (intent?: string) => boolean;
  /** After a press: `null` when it went through, or what it failed with. */
  settle: (error: unknown) => void;
}

/**
 * A refusal is an answer: the work was not queued. No answer, and a server failure, are not: a
 * request may have queued the work before the API or a gateway in front of it failed (the
 * development proxy and Caddy answer 502 when the connection drops).
 */
function isAnswered(status: number): boolean {
  return status > 0 && status < 500;
}

/**
 * Automatic seating and exports are started with a client UUID, which the backend treats as one
 * request however often it arrives (docs/API.md §6). A press that got no answer, or a server
 * failure, may have queued the work, so the next press with the same choices sends the same key
 * and gets that work back; a refusal ends the key. Other choices are another request, with a new
 * key: an export's key carries its intent, and changed intent is a 409. PD-53's retry id works the
 * same way.
 */
export function createRetryKey(make: () => string = () => crypto.randomUUID()): RetryKey {
  let pending: { key: string; intent: string } | null = null;
  return {
    next: (intent = '') => {
      if (pending?.intent !== intent) pending = { key: make(), intent };
      return pending.key;
    },
    isPending: (intent = '') => pending?.intent === intent,
    settle: (error) => {
      if (error === null || (isApiError(error) && isAnswered(error.status))) pending = null;
    },
  };
}
