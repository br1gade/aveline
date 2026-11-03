import { isApiError } from '@/api/errors';

/**
 * Why a recorded answer was refused (docs/API.md §6). The backend's sentences carry no codes, so
 * **a temporary stand-in (design PD-108)** recognises each by its exact words, or the start of
 * one that names a question, under a test that reads the source. A stale one means the page no
 * longer matches the event, so it reloads behind the words. Deleted when FR-28 gives codes.
 */
type SentenceKind = 'erased' | 'ticketVoid' | 'policyChanged' | 'signature';
type PrefixKind = 'questionRefused' | 'fieldRefused' | 'venueRefused' | 'modeChanged';

export type AnswerRefusal =
  | { kind: SentenceKind | PrefixKind | 'gone'; isStale: boolean; questionId?: string | undefined }
  | { kind: 'forbidden' | 'rateLimited'; isStale?: undefined }
  | { kind: 'noAnswer'; requestId?: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined; isStale?: undefined };

export const SENTENCES: ReadonlyArray<readonly [string, SentenceKind, boolean]> = [
  ["This guest's details were erased at their request", 'erased', true],
  ['Ticket is no longer valid; attendance cannot be reconfirmed', 'ticketVoid', false],
  [
    'attendanceRevision: attendance policy changed; reload the invitation and reconfirm',
    'policyChanged',
    true,
  ],
  ['answers: acknowledgements require the actual signer’s personal link', 'signature', false],
];

/** Sentences that name what they refuse; each means the invitation changed since the page read it. */
const PREFIXES: ReadonlyArray<readonly [RegExp, PrefixKind]> = [
  [/^answers: (\S+) (?:is not a question|is answered twice|must)/, 'questionRefused'],
  [
    /^(?:dietary|drinkPreference|songRequest|message|attribution): (?:this invitation|choose from)/,
    'fieldRefused',
  ],
  [/^venueAttendance: (?:venue is not guest-facing|a venue is answered twice)/, 'venueRefused'],
  [
    /^(?:status: required for event-wide|status: omit in per-venue|venueAttendance: this event takes one)/,
    'modeChanged',
  ],
];

function recognised(messages: readonly string[]): AnswerRefusal | null {
  const known = SENTENCES.find(([words]) => messages.includes(words));
  if (known) return { kind: known[1], isStale: known[2] };
  for (const message of messages) {
    for (const [pattern, kind] of PREFIXES) {
      const match = pattern.exec(message);
      if (match)
        return {
          kind,
          isStale: true,
          questionId: kind === 'questionRefused' ? match[1] : undefined,
        };
    }
  }
  return null;
}

export function refusalOf(error: unknown): AnswerRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId, code } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  // The one refusal here with a code of its own; the rest are told apart by their words (FR-28).
  if (code === 'ATTENDANCE_CHANGED') return { kind: 'policyChanged', isStale: true };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rateLimited' };
  const found = recognised(messages);
  if (found) return found;
  if (status === 404) return { kind: 'gone', isStale: true };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}
