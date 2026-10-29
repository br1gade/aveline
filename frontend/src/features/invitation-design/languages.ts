import type { DesignBlock, Translated } from './types';

/**
 * Which of the event's languages a block has no copy in. Guests reading one see the default
 * language's, block by block (`resolveTranslation`). A language the event stopped publishing is
 * never on the form, so a save leaves it as it is.
 */

export function languagesWithoutCopy(block: DesignBlock, locales: readonly string[]): string[] {
  return locales.filter((locale) => !Object.hasOwn(block.content, locale));
}

/** A translated text in the event's default language, else the first given. */
export function inDefaultLanguage(text: Translated, defaultLocale: string): string | undefined {
  return text[defaultLocale] ?? Object.values(text)[0];
}
