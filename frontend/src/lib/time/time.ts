/**
 * Event times are formatted in the event's own time zone, never the device's (docs/API.md §1):
 * a 6 pm ceremony must not read as 2 pm to a guest in London.
 *
 * English dates are day, month, year with a 24-hour clock (design R-24, provisional default
 * PD-11), so English formats with the en-GB conventions.
 */
const FORMAT_LOCALES: Readonly<Record<string, string>> = { en: 'en-GB', hy: 'hy-AM', ru: 'ru-RU' };

export interface EventZone {
  timeZone: string;
  locale: string;
}

export function formatLocale(locale: string): string {
  return FORMAT_LOCALES[locale] ?? locale;
}

/** An instant's calendar fields in a zone, from numeric parts every runtime formats the same. */
interface ZonedParts {
  year: number;
  month: number;
  day: number;
  /** 0 is Sunday. */
  weekday: number;
  hour: number;
  minute: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function zonedParts(iso: string, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(field('year')),
    month: Number(field('month')),
    day: Number(field('day')),
    weekday: WEEKDAYS.indexOf(field('weekday')),
    hour: Number(field('hour')),
    minute: Number(field('minute')),
  };
}

/**
 * Armenian dates are composed here, in the form the design gives ("շաբաթ, 12 հունիսի 2027 թ.",
 * GUEST_INVITATION §9). Intl cannot be trusted with them: Chrome ships no Armenian date data and
 * falls back to US English, and Node's ICU writes "2027 թ. հունիսի 12, շաբաթ", so the server's
 * and the browser's text would differ and break hydration. Draft wording, for a native reader
 * (PD-9).
 */
const ARMENIAN_MONTHS = [
  'հունվարի',
  'փետրվարի',
  'մարտի',
  'ապրիլի',
  'մայիսի',
  'հունիսի',
  'հուլիսի',
  'օգոստոսի',
  'սեպտեմբերի',
  'հոկտեմբերի',
  'նոյեմբերի',
  'դեկտեմբերի',
];
const ARMENIAN_WEEKDAYS = [
  'կիրակի',
  'երկուշաբթի',
  'երեքշաբթի',
  'չորեքշաբթի',
  'հինգշաբթի',
  'ուրբաթ',
  'շաբաթ',
];

function armenianDay(parts: ZonedParts): string {
  return `${parts.day} ${ARMENIAN_MONTHS[parts.month - 1] ?? ''} ${parts.year} թ.`;
}

/** "Saturday, 12 June 2027". */
export function formatEventDate(iso: string, zone: EventZone): string {
  if (zone.locale === 'hy') {
    const parts = zonedParts(iso, zone.timeZone);
    return `${ARMENIAN_WEEKDAYS[parts.weekday] ?? ''}, ${armenianDay(parts)}`;
  }
  return new Intl.DateTimeFormat(formatLocale(zone.locale), {
    timeZone: zone.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** "12 June 2027", without the weekday. */
export function formatEventDay(iso: string, zone: EventZone): string {
  if (zone.locale === 'hy') {
    return armenianDay(zonedParts(iso, zone.timeZone));
  }
  return new Intl.DateTimeFormat(formatLocale(zone.locale), {
    timeZone: zone.timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** "16:00": a 24-hour clock in every language, built from numbers so no runtime can vary it. */
export function formatEventTime(iso: string, zone: EventZone): string {
  const { hour, minute } = zonedParts(iso, zone.timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
}

const MINUTE = 60_000;

/**
 * Whole days, hours and minutes until `targetIso`, or `null` once it has passed. Minutes only, no
 * seconds: a counter that changes every second needs a pause control (WCAG 2.2.2, PD-35).
 */
export function timeLeftUntil(targetIso: string, now: Date): TimeLeft | null {
  const totalMinutes = Math.floor((new Date(targetIso).getTime() - now.getTime()) / MINUTE);
  if (totalMinutes < 0) {
    return null;
  }
  return {
    days: Math.floor(totalMinutes / (24 * 60)),
    hours: Math.floor(totalMinutes / 60) % 24,
    minutes: totalMinutes % 60,
  };
}
