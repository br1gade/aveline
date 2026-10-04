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
