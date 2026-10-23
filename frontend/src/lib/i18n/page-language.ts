import { useMatches } from 'react-router';

import { isLanguage, SOURCE_LANGUAGE, type Language } from './i18n';

/**
 * A route that knows its page's language says so in its `handle`, reading its loader data. Guest
 * pages use the `locale` the response names, not the one requested (docs/API.md §1).
 */
export interface LanguageHandle {
  pageLanguage: (loaderData: unknown) => string | undefined;
}

function hasLanguageHandle(handle: unknown): handle is LanguageHandle {
  return (
    typeof handle === 'object' &&
    handle !== null &&
    typeof (handle as Partial<LanguageHandle>).pageLanguage === 'function'
  );
}

export function usePageLanguage(): Language {
  const matches = useMatches();
  for (const match of [...matches].reverse()) {
    if (hasLanguageHandle(match.handle)) {
      const language = match.handle.pageLanguage(match.loaderData);
      if (isLanguage(language)) {
        return language;
      }
    }
  }
  return SOURCE_LANGUAGE;
}
