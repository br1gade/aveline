import { LOCALE } from '../../common/locale';

/**
 * The rules an event's core details must satisfy, at creation and after.
 *
 * Pure so the same rules hold for both paths: an event created with a
 * default language it does not publish used to be accepted, and every guest
 * page then fell back to a language the event never wrote copy in.
 */
export interface EventDetails {
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  locales: string[];
  defaultLocale: string;
}

/** What a host may be offered to tell guests about: when it is. Venues say so separately. */
export const NOTICE_WORTHY = ['startsAt', 'endsAt', 'timezone'] as const;


/** The first problem, naming its field — or null. */
export function detailsProblem(details: EventDetails): string | null {
  if (details.endsAt && details.endsAt <= details.startsAt) {
    return 'endsAt: must be after startsAt';
  }
  if (!isTimeZone(details.timezone)) {
    return `timezone: "${details.timezone}" is not an IANA time zone, such as Asia/Yerevan`;
  }
  return localesProblem(details.locales, details.defaultLocale);
}

function localesProblem(locales: string[], defaultLocale: string): string | null {
  const invalid = locales.find((locale) => !LOCALE.test(locale));
  if (invalid !== undefined) return `locales: "${invalid}" is not a language code, such as hy or en`;
  if (new Set(locales).size !== locales.length) return 'locales: list each language once';
  if (!locales.includes(defaultLocale)) {
    return `defaultLocale: "${defaultLocale}" must be one of the event's languages (${locales.join(', ')})`;
  }
  return null;
}

/** Which of these fields hold a different value after the edit. */
export function changedFields<T extends object>(before: T, after: T, fields: readonly (keyof T)[]): (keyof T)[] {
  return fields.filter((field) => !sameValue(before[field], after[field]));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
