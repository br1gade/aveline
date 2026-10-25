import type { UseFormSetError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';

import type { EventFormInput } from './schemas';
import { refusedFields } from './server-errors';

/** A failed write as a problem to show; a 400 also marks the fields it names. */
export function markRefusals(error: unknown, setError: UseFormSetError<EventFormInput>): Problem {
  if (isApiError(error) && error.status === 400) {
    for (const { field, code } of refusedFields(error.messages)) {
      setError(field, { type: 'server', message: code });
    }
  }
  return problemFrom(error);
}

export type EventAction = 'create' | 'edit' | 'notify';

/**
 * The words for a refusal. There is no permissions endpoint (FR-6), so every action is offered and
 * a 403 is explained after the fact. No 409 comes from these calls today; one would mean the
 * event's state changed underneath.
 */
export function useRefusedText(action: EventAction): (status: number) => string {
  const { t } = useTranslation('events');
  const { t: account } = useTranslation('account');
  return (status) => {
    if (status === 403) return t(`problems.${action}Forbidden`);
    if (status === 409) return t('problems.conflict');
    if (status === 400 && action === 'notify') return t('problems.notifyDraft');
    return account('problems.check');
  };
}
