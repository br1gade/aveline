/**
 * Translated content is stored as { "<locale>": <value> }. Resolution falls
 * back to the event's default locale, then to the first available translation,
 * so a partially translated invitation still renders rather than showing gaps.
 */
export type Translated = Record<string, unknown>;

export function resolveTranslation<T = unknown>(
  content: unknown,
  locale: string,
  defaultLocale: string,
): T | null {
  if (content === null || typeof content !== 'object') return null;
  const map = content as Translated;

  for (const key of [locale, defaultLocale]) {
    if (map[key] !== undefined) return map[key] as T;
  }

  const first = Object.values(map)[0];
  return first === undefined ? null : (first as T);
}

/**
 * Resolves a requested locale to one the event actually publishes.
 *
 * This is a boundary guard, not a convenience. The resolved value becomes a
 * Redis cache key, so an unvalidated locale on a public endpoint would let
 * anyone grow the keyspace without limit and evict every real entry. Bounding
 * the result to `available` bounds the keyspace to one entry per published
 * language.
 *
 * It also keeps the response honest: reporting a locale we are not serving is
 * a lie the client has no way to detect.
 */
export function negotiateLocale(
  requested: string | undefined,
  available: readonly string[],
  defaultLocale: string,
): string {
  if (!requested || available.length === 0) return defaultLocale;

  // Region tags are accepted for a language we publish: en-GB resolves to en.
  const language = requested.toLowerCase().split('-')[0];
  const match = available.find((locale) => locale.toLowerCase() === language);

  return match ?? defaultLocale;
}

/** A language code as events declare them: hy, en, ru, or a regional form like en-GB. */
export const LOCALE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
