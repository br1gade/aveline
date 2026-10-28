import type { UseFormSetError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';

import type { VenueFormInput } from './schemas';
import { refusedVenueFields } from './server-errors';

/** A failed write as a problem to show; a 400 also marks the fields it names. */
export function markRefusals(error: unknown, setError: UseFormSetError<VenueFormInput>): Problem {
  if (isApiError(error) && error.status === 400) {
    for (const { field, code } of refusedVenueFields(error.messages)) {
      setError(field, { type: 'server', message: code });
    }
  }
  return problemFrom(error);
}

/** The backend's own words for a refused removal, which name how many things use the venue. */
export function removalMessages(error: unknown): readonly string[] {
  return isApiError(error) && error.status === 400 ? error.messages : [];
}

/** Every sentence a refusal carried, for telling apart refusals that share a status. */
export function refusalMessages(error: unknown): readonly string[] {
  return isApiError(error) ? error.messages : [];
}

export type VenueAction = 'create' | 'edit' | 'remove';

type ProblemKey =
  | 'forbidden'
  | 'missing'
  | 'eventMissing'
  | 'conflict'
  | 'inUse'
  | 'hasAnswers'
  | 'guestFacing'
  | 'check'
  | 'other';

/**
 * Refusals that name no field the form shows and share their status with others, told apart by
 * the backend's text (`venues.service.ts`, `venue-attendance.ts`; codes asked for in FR-28). A
 * reworded sentence falls back to the status's words, never to a wrong one.
 */
const BY_TEXT: ReadonlyArray<readonly [VenueAction, number, RegExp, ProblemKey]> = [
  ['remove', 400, /^venue: attendance history exists/, 'hasAnswers'],
  ['edit', 409, /^venue: attendance, checkout choices or seats exist/, 'guestFacing'],
];

/**
 * The words for each refusal, by action and status. There is no permissions endpoint (FR-6), so
 * every action is offered and a 403 is explained after the fact: writing venues needs
 * `event:write`. A removal's 400 is otherwise the venue still in use (FR-28).
 */
const WORDS: Readonly<Record<VenueAction, Partial<Record<number, ProblemKey>>>> = {
  create: { 400: 'check', 403: 'forbidden', 404: 'eventMissing', 409: 'conflict' },
  edit: { 400: 'check', 403: 'forbidden', 404: 'missing', 409: 'conflict' },
  remove: { 400: 'inUse', 403: 'forbidden', 404: 'missing', 409: 'conflict' },
};

export function useRefusedText(
  action: VenueAction,
): (status: number, messages?: readonly string[]) => string {
  const { t } = useTranslation('venues');
  return (status, messages = []) => {
    const byText = BY_TEXT.find(
      ([forAction, forStatus, pattern]) =>
        forAction === action &&
        forStatus === status &&
        messages.some((message) => pattern.test(message)),
    );
    return t(`problems.${byText?.[3] ?? WORDS[action][status] ?? 'other'}`);
  };
}
