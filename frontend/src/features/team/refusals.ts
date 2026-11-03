import { isApiError } from '@/api/errors';

/**
 * Why a team action was refused (docs/API.md §6). The backend's 400s and 404s are English sentences
 * under one code per status, so **a temporary stand-in (design PD-100)** recognises each by its
 * exact words, under a test that reads the source, and anything else is shown as it came, marked
 * English. Deleted when FR-28 gives codes.
 */
type StaleKind =
  'alreadyOnTeam' | 'needsOwner' | 'activeOwnerOnly' | 'notOnTeam' | 'noPendingInvite';

export type TeamRefusal =
  | {
      kind: StaleKind | 'gone';
      /** The team is not what the page shows: reload it behind the words. */
      isStale: true;
    }
  | { kind: 'forbidden' | 'rateLimited' | 'emailRefused'; isStale?: undefined }
  | { kind: 'noAnswer'; requestId?: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined; isStale?: undefined };

export const SENTENCES: ReadonlyArray<readonly [string, StaleKind]> = [
  ["That person is already on this event's team", 'alreadyOnTeam'],
  ['An event needs an owner; make someone else an owner first', 'needsOwner'],
  ['An event needs an active owner; make someone else an owner first', 'needsOwner'],
  ['Only an active event member may become owner', 'activeOwnerOnly'],
  ["That person is not on this event's team", 'notOnTeam'],
  ['No pending invitation for that address', 'noPendingInvite'],
];

function refusedSentence(
  status: number,
  messages: readonly string[],
  requestId: string | undefined,
): TeamRefusal {
  const known = SENTENCES.find(([words]) => messages.includes(words));
  if (known) return { kind: known[1], isStale: true };
  if (status === 404) return { kind: 'gone', isStale: true };
  // class-validator starts with the property (FR-20); it is the form's one typed field.
  if (messages.some((message) => /^email\b/.test(message))) return { kind: 'emailRefused' };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}

export function refusalOf(error: unknown): TeamRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rateLimited' };
  return refusedSentence(status, messages, requestId);
}
