/**
 * Applies an edit to translated content, one language at a time.
 *
 * Each language sent replaces that language's copy; a language not sent is
 * kept; a language sent as `null` is removed. The whole map used to be
 * replaced, so a host who corrected the English wording deleted the Armenian
 * invitation along with it — "omitted means leave as is" applies to
 * languages as much as to fields.
 */
export function mergeTranslations(
  current: unknown,
  edit: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = isRecord(current) ? { ...current } : {};

  for (const [locale, copy] of Object.entries(edit)) {
    if (copy === null) delete merged[locale];
    else merged[locale] = copy;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
