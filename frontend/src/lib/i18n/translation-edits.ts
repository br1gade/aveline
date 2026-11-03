/**
 * Per-language words as the backend stores them, and the edit that changes them (docs/API.md §6,
 * "Correcting an event", "Venues", "The running order"). The backend takes one language at a time:
 * a language sent replaces that language whole, `null` removes it, and one left out is unchanged.
 * Blank words count as none, as the backend reads them.
 */

/** Each language's words, by field: what a form shows, an empty string where nothing is stored. */
export type TranslationValues<Field extends string> = Record<string, Record<Field, string>>;

/** The `translations` body: a language whole, or `null` to remove it. */
export type TranslationEdits<Field extends string> = Record<
  string,
  Partial<Record<Field, string>> | null
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A language's non-blank words, trimmed. */
function wordsOf<Field extends string>(
  copy: unknown,
  fields: readonly Field[],
): Partial<Record<Field, string>> {
  const words: Partial<Record<Field, string>> = {};
  if (!isRecord(copy)) return words;
  for (const field of fields) {
    const text = textOf(copy[field]);
    if (text) words[field] = text;
  }
  return words;
}

function isSameWords<Field extends string>(
  a: Partial<Record<Field, string>>,
  b: Partial<Record<Field, string>>,
  fields: readonly Field[],
): boolean {
  return fields.every((field) => a[field] === b[field]);
}

/** The stored words of each language asked for, every field present, for a form's fields. */
export function translationValues<Field extends string>(
  stored: unknown,
  languages: readonly string[],
  fields: readonly Field[],
): TranslationValues<Field> {
  const map = isRecord(stored) ? stored : {};
  const values: TranslationValues<Field> = {};
  for (const language of languages) {
    const words = wordsOf(map[language], fields);
    values[language] = Object.fromEntries(
      fields.map((field) => [field, words[field] ?? '']),
    ) as Record<Field, string>;
  }
  return values;
}

/**
 * The languages whose own words a form shows: each of the event's but the default, whose words are
 * the plain fields. A translation stored for the default is shown too, first: guests reading the
 * default see it instead of the plain words (`translatedField`), so it must be clearable.
 */
export function translatedLanguages<Field extends string>(
  locales: readonly string[],
  defaultLocale: string,
  stored: unknown,
  fields: readonly Field[],
): string[] {
  const map = isRecord(stored) ? stored : {};
  const others = locales.filter((locale) => locale !== defaultLocale);
  const hasDefaultWords = Object.keys(wordsOf(map[defaultLocale], fields)).length > 0;
  return hasDefaultWords ? [defaultLocale, ...others] : others;
}

/**
 * Only the languages the form changed. A changed language goes whole, without its blank fields; a
 * language whose words were all emptied is removed; a stored language the form doesn't show is
 * left alone.
 */
export function translationEdits<Field extends string>(
  stored: unknown,
  values: Readonly<Record<string, Readonly<Record<Field, string>>>>,
  fields: readonly Field[],
): TranslationEdits<Field> {
  const map = isRecord(stored) ? stored : {};
  const edits: TranslationEdits<Field> = {};
  for (const [language, copy] of Object.entries(values)) {
    const before = wordsOf(map[language], fields);
    const after = wordsOf(copy, fields);
    if (isSameWords(before, after, fields)) continue;
    edits[language] = Object.keys(after).length > 0 ? after : null;
  }
  return edits;
}

/**
 * A label kept one string per language (a running-order entry's). Changed languages are sent, an
 * emptied one is `null`, which the backend merges into what it has.
 */
export function labelEdits(
  stored: Readonly<Record<string, unknown>>,
  values: Readonly<Record<string, string>>,
): Record<string, string | null> {
  const edits: Record<string, string | null> = {};
  for (const [language, value] of Object.entries(values)) {
    const before = textOf(stored[language]);
    const after = value.trim();
    if (before !== after) edits[language] = after || null;
  }
  return edits;
}

/** Words in one language, and which: the language asked for, else the first that has any. */
export function wordsIn(
  copy: Readonly<Record<string, string>>,
  language: string,
): { text: string; language: string } | null {
  const own = copy[language]?.trim();
  if (own) return { text: own, language };
  const first = Object.entries(copy).find(([, text]) => text.trim() !== '');
  return first ? { text: first[1].trim(), language: first[0] } : null;
}
