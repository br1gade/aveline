import { useTranslation } from 'react-i18next';

/** The zones whose city Aveline names in each language; any other keeps its IANA name. */
const ZONE_CITY_KEYS = new Map<string, 'zoneCity.yerevan' | 'zoneCity.moscow'>([
  ['Asia/Yerevan', 'zoneCity.yerevan'],
  ['Europe/Moscow', 'zoneCity.moscow'],
]);

/**
 * An event's time zone as a sentence on the page names it: the city in the page's language where
 * Aveline has one, "Ереван" rather than "Asia/Yerevan" (audit 20 Nov, A2-14); otherwise the IANA
 * name with its underscores as spaces. The sentences around it are written for a zone's name.
 */
export function useZoneName(): (timeZone: string) => string {
  const { t } = useTranslation('common');
  return (timeZone) => {
    const key = ZONE_CITY_KEYS.get(timeZone);
    return key ? t(key) : timeZone.replaceAll('_', ' ');
  };
}
