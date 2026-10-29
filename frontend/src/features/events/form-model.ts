import { LANGUAGES } from '@/lib/i18n';
import { wallTimeOf } from '@/lib/time';

import type { EventFormInput, EventFormValues } from './schemas';
import type { EventDetail } from './types';

/** The backend's own default zone and language (docs/API.md §6, "Creating an event"). */
export const DEFAULT_TIME_ZONE = 'Asia/Yerevan';

export const NEW_EVENT_VALUES: EventFormInput = {
  type: '',
  title: '',
  hostsLabel: '',
  date: '',
  time: '',
  timezone: DEFAULT_TIME_ZONE,
  locales: ['hy'],
  defaultLocale: 'hy',
};

/** An event as the form shows it: its start read in its own zone, never the device's. */
export function formValuesOf(event: EventDetail): EventFormValues {
  return {
    type: event.type,
    title: event.title.trim(),
    hostsLabel: event.hostsLabel.trim(),
    ...wallTimeOf(event.startsAt, event.timezone),
    timezone: event.timezone,
    locales: [...event.locales],
    defaultLocale: event.defaultLocale,
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
