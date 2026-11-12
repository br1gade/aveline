import { LANGUAGES, translationValues } from '@/lib/i18n';
import { DEFAULT_TIME_ZONE, wallTimeOf } from '@/lib/time';

import type { EventFormInput, EventFormValues } from './schemas';
import type { EventDetail } from './types';

export const NEW_EVENT_VALUES: EventFormInput = {
  type: '',
  title: '',
  hostsLabel: '',
  date: '',
  time: '',
  timezone: DEFAULT_TIME_ZONE,
  locales: ['hy'],
  defaultLocale: 'hy',
  endDate: '',
  endTime: '',
  sideALabel: '',
  sideBLabel: '',
  translations: {},
};

/** What an event's title, hosts and side labels are called in `translations` (FR-96). */
export const EVENT_TRANSLATED = ['title', 'hostsLabel', 'sideALabel', 'sideBLabel'] as const;

/** Every language the form could show, so ticking one reveals its stored words, or empty ones. */
function formLanguages(event: EventDetail): string[] {
  const stored = event.translations;
  const keys = typeof stored === 'object' && stored !== null ? Object.keys(stored) : [];
  const offered = languageOptions(event.locales);
  return [...offered, ...keys.filter((key) => !offered.includes(key))];
}

/** An event as the form shows it: its start and end read in its own zone, never the device's. */
export function formValuesOf(event: EventDetail): EventFormValues {
  const end = event.endsAt ? wallTimeOf(event.endsAt, event.timezone) : { date: '', time: '' };
  return {
    type: event.type,
    title: event.title.trim(),
    hostsLabel: event.hostsLabel.trim(),
    ...wallTimeOf(event.startsAt, event.timezone),
    timezone: event.timezone,
    locales: [...event.locales],
    defaultLocale: event.defaultLocale,
    endDate: end.date,
    endTime: end.time,
    sideALabel: (event.sideALabel ?? '').trim(),
    sideBLabel: (event.sideBLabel ?? '').trim(),
    translations: translationValues(event.translations, formLanguages(event), EVENT_TRANSLATED),
  };
}

/**
 * The languages a host may tick: Aveline's three (C-5) and French (C-23), and any other the event
 * already has, so an edit never drops one it cannot show.
 */
export function languageOptions(eventLocales: readonly string[] = []): string[] {
  const offered: readonly string[] = LANGUAGES;
  return [...offered, ...eventLocales.filter((locale) => !offered.includes(locale))];
}

export interface LanguageChoice {
  locales: string[];
  defaultLocale: string;
}

/**
 * The languages after ticking or unticking one, in the order they are offered. The default stays
 * among them: when its own language is unticked, the first ticked one takes over.
 */
export function toggleLanguage(
  choice: LanguageChoice,
  language: string,
  isTicked: boolean,
  options: readonly string[],
): LanguageChoice {
  const ticked = isTicked
    ? [...choice.locales, language]
    : choice.locales.filter((locale) => locale !== language);
  const locales = options.filter((option) => ticked.includes(option));
  const defaultLocale = locales.includes(choice.defaultLocale)
    ? choice.defaultLocale
    : (locales[0] ?? '');
  return { locales, defaultLocale };
}
