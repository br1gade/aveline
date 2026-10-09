import { LOCALE } from './locale';

/**
 * Per-language versions of a few plain fields — an event's title, a venue's
 * name — stored as `{ "en": { "title": "..." } }` beside the plain column,
 * which stays the fallback.
 *
 * Separate from translated block content, which is translated whole: these
 * are single strings a host types once and translates when a diaspora family
 * asks, and a missing translation must fall back to the original rather than
 * show nothing.
 */
export type FieldLimits = Readonly<Record<string, number>>;

export const EVENT_TRANSLATABLE: FieldLimits = { title: 200, hostsLabel: 200 };
export const VENUE_TRANSLATABLE: FieldLimits = { name: 160, address: 300 };

/** The first problem with an edit, naming `translations` — or null. */
export function translationsProblem(edit: Record<string, unknown>, fields: FieldLimits): string | null {
  for (const [locale, copy] of Object.entries(edit)) {
    if (!LOCALE.test(locale)) return `translations: "${locale}" is not a language code, such as hy or en`;
    if (copy === null) continue;
    if (typeof copy !== 'object' || Array.isArray(copy)) return `translations: ${locale} must be an object or null`;

    const problem = fieldsProblem(locale, copy as Record<string, unknown>, fields);
    if (problem) return problem;
  }
  return null;
}

/** The field in this language, if it has been translated. */
export function translatedField(translations: unknown, locale: string, field: string): string | undefined {
  const copy = (translations as Record<string, Record<string, unknown> | undefined> | null)?.[locale];
  const value = copy?.[field];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function fieldsProblem(locale: string, copy: Record<string, unknown>, fields: FieldLimits): string | null {
  for (const [field, value] of Object.entries(copy)) {
    const limit = fields[field];
    if (limit === undefined) return `translations: ${locale}.${field} is not translatable; use ${Object.keys(fields).join(' or ')}`;
    if (typeof value !== 'string' || value.length > limit) {
      return `translations: ${locale}.${field} must be text of at most ${limit} characters`;
    }
  }
  return null;
}
