import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';

export type GuestAction = 'add' | 'edit' | 'household' | 'remove' | 'import';

/** A failed write: what to say, and whether the list on screen is now out of date. */
export interface Refusal {
  problem: Problem;
  /** The backend's sentences, for telling apart refusals that share a status (FR-28). */
  messages: readonly string[];
  /** A 400 whose messages named fields, which now carry them. */
  isOnFields: boolean;
  /** Something changed underneath: the list reloads behind the message (docs/API.md §6). */
  isListStale: boolean;
}

/** A 400's messages, for `server-errors.ts` to place; none for any other failure. */
export function badRequestMessages(error: unknown): readonly string[] {
  return isApiError(error) && error.status === 400 ? error.messages : [];
}

/**
 * A 404 means the guest or household went meanwhile. A 409 on an edit or a removal is a move made
 * at the same moment (both lock the guest's household first). A 400 that names no field on an edit
 * is an erased guest; on a removal it can only be a check-in (`removalProblem` in the backend).
 * Each leaves the list on screen out of date.
 */
function isListStale(action: GuestAction, status: number, fieldsMarked: number): boolean {
  if (status === 404) return true;
  if (status === 409) return action === 'edit' || action === 'remove';
  if (status !== 400) return false;
  return action === 'remove' || (action === 'edit' && fieldsMarked === 0);
}

export function refusalOf(error: unknown, action: GuestAction, fieldsMarked = 0): Refusal {
  const problem = problemFrom(error);
  const status = problem.code === 'refused' ? problem.status : 0;
  return {
    problem,
    messages: isApiError(error) ? error.messages : [],
    isOnFields: fieldsMarked > 0,
    isListStale: isListStale(action, status, fieldsMarked),
  };
}

type ProblemKey =
  | 'check'
  | 'addForbidden'
  | 'editForbidden'
  | 'householdForbidden'
  | 'removeForbidden'
  | 'importForbidden'
  | 'addMissing'
  | 'editMissing'
  | 'householdMissing'
  | 'removeMissing'
  | 'importMissing'
  | 'editErased'
  | 'checkedIn'
  | 'ticketLinked'
  | 'acknowledged'
  | 'moved'
  | 'importRunning'
  | 'tooLarge'
  | 'tooManyRows';

/**
 * The words for each refusal, by action and status. There is no permissions endpoint (FR-6), so
 * every action is offered and a 403 is explained after the fact. The backend's reasons that name no
 * field are English sentences without a code (FR-28), so the status and the action decide.
 */
const WORDS: Readonly<Record<GuestAction, Partial<Record<number, ProblemKey>>>> = {
  add: { 400: 'check', 403: 'addForbidden', 404: 'addMissing' },
  edit: { 400: 'editErased', 403: 'editForbidden', 404: 'editMissing', 409: 'moved' },
  household: { 400: 'check', 403: 'householdForbidden', 404: 'householdMissing' },
  remove: { 400: 'checkedIn', 403: 'removeForbidden', 404: 'removeMissing', 409: 'moved' },
  import: {
    400: 'tooManyRows',
    403: 'importForbidden',
    404: 'importMissing',
    409: 'importRunning',
    413: 'tooLarge',
  },
};

/**
 * A removal's other 400s since `eb77cd4`, told apart from a check-in by their exact text
 * (`guest-management.service.ts`; design PD-54, a stand-in until FR-28 gives them codes). A
 * reworded sentence falls back to the check-in's words, as before.
 */
const REMOVAL_BY_TEXT: ReadonlyArray<readonly [RegExp, ProblemKey]> = [
  [/^This guest is linked to a ticket/, 'ticketLinked'],
  [/^This guest has acknowledgement evidence/, 'acknowledged'],
];

function keyOf(action: GuestAction, status: number, messages: readonly string[]) {
  const byText =
    action === 'remove' && status === 400
      ? REMOVAL_BY_TEXT.find(([pattern]) => messages.some((message) => pattern.test(message)))
      : undefined;
  return byText?.[1] ?? WORDS[action][status];
}

export function useRefusedText(
  action: GuestAction,
  isOnFields: boolean,
): (status: number, messages?: readonly string[]) => string {
  const { t } = useTranslation('guests');
  return (status, messages = []) => {
    if (status === 400 && isOnFields) return t('problems.check');
    const key = keyOf(action, status, messages);
    return key ? t(`problems.${key}`) : t('problems.other');
  };
}
