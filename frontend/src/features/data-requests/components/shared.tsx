import { useTranslation } from 'react-i18next';

import { DEFAULT_TIME_ZONE, formatEventDay } from '@/lib/time';
import { WordedRefusal } from '@/ui/app-form';

import type { RequestRefusal } from '../refusals';

export function RequestProblem({ refusal }: { refusal: RequestRefusal }) {
  const { t } = useTranslation('data-requests');
  return (
    <WordedRefusal
      message={t(`refusal.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

/** No event names a zone here, so dates are Yerevan's, and the page says so. */
export function useRequestDay() {
  const { i18n } = useTranslation();
  return (iso: string) =>
    formatEventDay(iso, { timeZone: DEFAULT_TIME_ZONE, locale: i18n.language });
}
