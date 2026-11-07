import { data } from 'react-router';

import { isLanguage, SOURCE_LANGUAGE, type Language } from './i18n';
import { negotiateLanguage } from './negotiate';
import type { LanguageHandle } from './page-language';

/**
 * The route plumbing for a page that negotiates its language (PD-40): the account pages and the
 * app's layout. The loader returns the language, and sets the cookie when `?lang=` chose one; the
 * route passes that header on, and names the language for `<html lang>` through its handle.
 */
export function negotiatedLanguageData(request: Request) {
  const { language, setCookie } = negotiateLanguage(request);
  return data({ language }, setCookie ? { headers: { 'Set-Cookie': setCookie } } : undefined);
}

export function languageOf(loaderData: unknown): Language | undefined {
  if (typeof loaderData !== 'object' || loaderData === null || !('language' in loaderData)) {
    return undefined;
  }
  return isLanguage(loaderData.language) ? loaderData.language : undefined;
}

/** The language a parent route negotiated, for a child's `meta`. */
export function languageOfMatches(
  matches: ReadonlyArray<{ loaderData: unknown } | undefined>,
): Language {
  for (const match of matches) {
    const language = languageOf(match?.loaderData);
    if (language) return language;
  }
  return SOURCE_LANGUAGE;
}

export const negotiatedLanguageHandle: LanguageHandle = { pageLanguage: languageOf };

/** A route's `headers`: the loader's, so its `Set-Cookie` reaches the document response. */
export function passLoaderHeaders({ loaderHeaders }: { loaderHeaders: Headers }): Headers {
  return loaderHeaders;
}
