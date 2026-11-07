import { useTranslation } from 'react-i18next';

import { DEFAULT_TIME_ZONE, formatEventDay } from '@/lib/time';
import { WordedRefusal } from '@/ui/app-form';

import type { OrganizationRefusal } from '../refusals';
import type { OrganizationRole } from '../types';

/** A refusal in our words (FR-6: a 403 is worded, not hidden). */
export function OrganizationProblem({ refusal }: { refusal: OrganizationRefusal }) {
  const { t } = useTranslation('organization');
  return (
    <WordedRefusal
      message={t(`refusal.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

export function useRoleName() {
  const { t } = useTranslation('organization');
  return (role: OrganizationRole | null) => (role ? t(`role.${role}.name`) : t('role.unknown'));
}

/** No event names a zone here, so dates are Yerevan's, and the page says so. */
export function useOrganizationDay() {
  const { i18n } = useTranslation();
  return (iso: string) =>
    formatEventDay(iso, { timeZone: DEFAULT_TIME_ZONE, locale: i18n.language });
}
