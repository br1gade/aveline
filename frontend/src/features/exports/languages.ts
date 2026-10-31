import { isLanguage, LANGUAGES, type Language } from '@/lib/i18n';

/**
 * A snapshot's headings, labels and standard values come in en, ru, fr or hy (docs/API.md §6), the
 * interface's four languages; names, answers and notes stay as they were written.
 */
export const FILE_LANGUAGES: readonly Language[] = LANGUAGES;

/** The event's default language, as the backend's own default, or the page's when it has none. */
export function defaultFileLanguage(eventLanguage: string, pageLanguage: Language): Language {
  const language = eventLanguage.toLowerCase().split('-')[0];
  return isLanguage(language) ? language : pageLanguage;
}
