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

export type VenueAction = 'create' | 'edit' | 'remove';

type ProblemKey =
  'forbidden' | 'missing' | 'eventMissing' | 'conflict' | 'inUse' | 'check' | 'other';

/**
 * The words for each refusal, by action and status. There is no permissions endpoint (FR-6), so
 * every action is offered and a 403 is explained after the fact: writing venues needs
 * `event:write`. A removal's 400 is the venue still in use, the only one it gives (FR-28).
 */
const WORDS: Readonly<Record<VenueAction, Partial<Record<number, ProblemKey>>>> = {
  create: { 400: 'check', 403: 'forbidden', 404: 'eventMissing', 409: 'conflict' },
  edit: { 400: 'check', 403: 'forbidden', 404: 'missing', 409: 'conflict' },
  remove: { 400: 'inUse', 403: 'forbidden', 404: 'missing', 409: 'conflict' },
};

export function useRefusedText(action: VenueAction): (status: number) => string {
  const { t } = useTranslation('venues');
  return (status) => {
    const key = WORDS[action][status];
    return t(`problems.${key ?? 'other'}`);
  };
}
