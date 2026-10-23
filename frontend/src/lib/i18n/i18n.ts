import i18next, { type i18n } from 'i18next';

import { resources } from '@/locales';

/**
 * Interface strings in hy, ru and en (decision A2). English is the source; Armenian and Russian
 * are drafts until a native reader checks them (design PD-9).
 *
 * Each server render makes its own instance, so two requests in different languages never share
 * one. Resources are bundled, so initialisation is synchronous.
 */
export const LANGUAGES = ['hy', 'ru', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const SOURCE_LANGUAGE: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng: language,
    fallbackLng: SOURCE_LANGUAGE,
    resources,
    defaultNS: 'common',
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}
