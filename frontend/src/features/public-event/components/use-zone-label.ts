import { useTranslation } from 'react-i18next';

import { intlZoneName, zoneLabelKey } from '@/features/invitation-renderer';

/** "Yerevan time" where the city's name is translated, otherwise Intl's own name (design R-22). */
export function useZoneLabel(startsAt: string, timeZone: string, locale: string): string {
  const { t } = useTranslation('invitation');
  const key = zoneLabelKey(timeZone);
  return key ? t(key) : intlZoneName(startsAt, { timeZone, locale });
}
