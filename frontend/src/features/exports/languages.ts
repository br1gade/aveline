import { isOfferedLanguage, OFFERED_LANGUAGES, type OfferedLanguage } from '@/lib/i18n';

/**
 * A snapshot's headings, labels and standard values come in en, ru, fr or hy (docs/API.md §6); the
 * pilot offers the interface's three, not French. Names, answers and notes stay as they were written.
 */
export const FILE_LANGUAGES: readonly OfferedLanguage[] = OFFERED_LANGUAGES;

/** The event's default language, as the backend's own default, or the page's when it has none. */
export function defaultFileLanguage(eventLanguage: string, pageLanguage: string): OfferedLanguage {
  const language = eventLanguage.toLowerCase().split('-')[0];
  if (isOfferedLanguage(language)) return language;
  return isOfferedLanguage(pageLanguage) ? pageLanguage : 'en';
}
