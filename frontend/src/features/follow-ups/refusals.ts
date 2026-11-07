import { isApiError } from '@/api/errors';

/**
 * Why a reminder or a thank-you was refused (docs/API.md §6). The backend's 400s are English
 * sentences under one code, so **a temporary stand-in (design PD-97)** recognises each by its exact
 * words, under a test that reads the source, and anything else is shown as it came, marked English.
 * Deleted when FR-28 gives codes.
 */
export type FollowUpRefusal =
  | {
      kind: 'notPublished' | 'expired' | 'started' | 'notYet' | 'gone';
      /** The page is out of date: reload it behind the words. */
      isStale: true;
    }
  | { kind: 'forbidden' | 'rateLimited'; isStale?: undefined }
  | { kind: 'noAnswer'; requestId?: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined; isStale?: undefined };

export const SENTENCES = [
  // A stopped invitation hears this too, which the page words so that it holds for both (§3).
  ['This invitation has not been published, so nobody has it yet', 'notPublished'],
  ['This invitation has expired', 'expired'],
  ['This event has already started; a reminder would read oddly', 'started'],
  ['This event has not happened yet; a thank-you now would arrive before the event', 'notYet'],
] as const;

function refusedSentence(messages: readonly string[], requestId?: string): FollowUpRefusal {
  const known = SENTENCES.find(([words]) => messages.includes(words));
  if (known) return { kind: known[1], isStale: true };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}

export function refusalOf(error: unknown): FollowUpRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 404) return { kind: 'gone', isStale: true };
  if (status === 429) return { kind: 'rateLimited' };
  return refusedSentence(messages, requestId);
}
