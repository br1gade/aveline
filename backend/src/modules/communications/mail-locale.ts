import { MAIL_FALLBACK_LOCALE } from '../../common/locale';

/**
 * The language a message is written in: the reader's if its copy has it, else
 * the event's, else English, else the first the copy has. One language for
 * the whole message — subject, body and footer — rather than each part
 * falling back on its own.
 */
export function mailLocale(copy: unknown, readerLocale: string, eventLocale: string | undefined): string {
  const languages = copy !== null && typeof copy === 'object' ? Object.keys(copy) : [];
  const preferred = [readerLocale, eventLocale, MAIL_FALLBACK_LOCALE].find((locale) => locale !== undefined && languages.includes(locale));
  return preferred ?? languages[0] ?? readerLocale;
}
