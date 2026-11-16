import i18next, { type i18n } from 'i18next';

import '@/locales/guest';
import { strings } from '@/locales/registry';

/**
 * Interface strings in hy, ru and en (decision A2), and French (design C-23), which is kept but not
 * offered for the pilot (`OFFERED_LANGUAGES`). English is the source; Armenian and Russian are drafts
 * until a native reader checks them (design PD-9).
 *
 * Each server render makes its own instance, so two requests in different languages never share
 * one. Resources are bundled, so initialisation is synchronous. Routes add their own to the shared
 * registry as they load (`locales/registry.ts`).
 */
export const LANGUAGES = ['hy', 'ru', 'en', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];
export const SOURCE_LANGUAGE: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * The languages offered for the pilot: French is not one (decided 14 November 2026), so no menu,
 * negotiation or event form offers it. Its strings stay, so an invitation or public event that
 * already has French still shows in it; a page that negotiates (sign-in, the app, a buyer's order
 * opened with `?lang=fr`) falls back to the visitor's offered language.
 */
export const OFFERED_LANGUAGES = ['hy', 'ru', 'en'] as const satisfies readonly Language[];
export type OfferedLanguage = (typeof OFFERED_LANGUAGES)[number];

export function isOfferedLanguage(value: unknown): value is OfferedLanguage {
  return typeof value === 'string' && (OFFERED_LANGUAGES as readonly string[]).includes(value);
}

export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng: language,
    fallbackLng: SOURCE_LANGUAGE,
    resources: strings,
    defaultNS: 'common',
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}
