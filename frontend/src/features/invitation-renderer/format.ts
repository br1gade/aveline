import {
  formatEventDate,
  formatEventDay,
  formatEventTime,
  formatLocale,
  type EventZone,
} from '@/lib/time';

/**
 * Display forms of event times. Every time is in the event's zone (C-16); English is day, month,
 * year on a 24-hour clock (PD-11).
 */

/** Intl gives Russian, Armenian and French weekdays in lower case; a display line starts with a capital. */
export function capitalise(text: string, locale: string): string {
  const first = text.charAt(0);
  return first ? first.toLocaleUpperCase(formatLocale(locale)) + text.slice(1) : text;
}

/** "Saturday, 12 June 2027". */
export function displayDate(iso: string, zone: EventZone): string {
  return capitalise(formatEventDate(iso, zone), zone.locale);
}

/** "12 June 2027": day headings and "Sent on …". */
export function displayDay(iso: string, zone: EventZone): string {
  return formatEventDay(iso, zone);
}

export function displayTime(iso: string, zone: EventZone): string {
  return formatEventTime(iso, zone);
}

/** The calendar day of an instant in the event's zone, for grouping: "2027-06-12". */
export function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** Interface-string keys for the zones whose city names are translated (design R-22). */
export const ZONE_LABEL_KEYS = {
  'Asia/Yerevan': 'timeZone.yerevan',
  'Europe/Moscow': 'timeZone.moscow',
} as const;

export type ZoneLabelKey = (typeof ZONE_LABEL_KEYS)[keyof typeof ZONE_LABEL_KEYS];

export function zoneLabelKey(timeZone: string): ZoneLabelKey | undefined {
  return Object.hasOwn(ZONE_LABEL_KEYS, timeZone)
    ? ZONE_LABEL_KEYS[timeZone as keyof typeof ZONE_LABEL_KEYS]
    : undefined;
}

/**
 * For a zone without a translated label: Intl's own name for it, such as "Central European Time".
 * In English on Armenian pages, because browsers without Armenian data would name it differently
 * from the server (see lib/time).
 */
export function intlZoneName(iso: string, zone: EventZone): string {
  const part = new Intl.DateTimeFormat(formatLocale(zone.locale === 'hy' ? 'en' : zone.locale), {
    timeZone: zone.timeZone,
    timeZoneName: 'longGeneric',
  })
    .formatToParts(new Date(iso))
    .find((candidate) => candidate.type === 'timeZoneName');
  return part?.value ?? zone.timeZone;
}
