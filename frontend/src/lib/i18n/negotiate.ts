import { isLanguage, SOURCE_LANGUAGE, type Language } from './i18n';

/**
 * The language of a page that has no event to take it from: sign-in, the account pages and the
 * app (design PD-40, until product answers PQ-10). Invitations never use this; they show the
 * `locale` their response names.
 *
 * In order: `?lang=` (the switcher's links), the cookie a previous `?lang=` set, the browser's
 * `Accept-Language`, then English. The cookie only remembers a choice; it unlocks nothing.
 */
export const LANGUAGE_COOKIE = 'aveline-lang';
const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

export interface NegotiatedLanguage {
  language: Language;
  /** A `Set-Cookie` value when the request chose a language with `?lang=`. */
  setCookie?: string;
}

export function negotiateLanguage(request: Request): NegotiatedLanguage {
  const url = new URL(request.url);
  const chosen = url.searchParams.get('lang');
  if (isLanguage(chosen)) {
    return { language: chosen, setCookie: languageCookie(chosen, url.protocol === 'https:') };
  }
  const remembered = cookieValue(request.headers.get('cookie'), LANGUAGE_COOKIE);
  if (isLanguage(remembered)) {
    return { language: remembered };
  }
  return { language: fromAcceptLanguage(request.headers.get('accept-language')) };
}

function languageCookie(language: Language, isSecure: boolean): string {
  const attributes = [`Path=/`, `Max-Age=${ONE_YEAR_IN_SECONDS}`, 'SameSite=Lax'];
  return [`${LANGUAGE_COOKIE}=${language}`, ...attributes, ...(isSecure ? ['Secure'] : [])].join(
    '; ',
  );
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, value] = part.trim().split('=');
    if (key === name) {
      return value;
    }
  }
  return undefined;
}

/** The first of hy, ru and en the browser prefers, by quality; a region tag counts as its language. */
export function fromAcceptLanguage(header: string | null): Language {
  const ranked = (header ?? '')
    .split(',')
    .map((entry, position) => {
      const [tag = '', ...parameters] = entry.trim().split(';');
      const quality = parameters.map((parameter) => /^\s*q=([\d.]+)\s*$/.exec(parameter)?.[1])[0];
      return {
        language: tag.split('-')[0]?.toLowerCase(),
        quality: Number(quality ?? 1),
        position,
      };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.position - b.position);
  return ranked.map((entry) => entry.language).find(isLanguage) ?? SOURCE_LANGUAGE;
}
