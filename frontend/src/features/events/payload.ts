import type { components } from '@/api/schema';
import { translatedLanguages, translationEdits } from '@/lib/i18n';
import { instantFromWallTime } from '@/lib/time';

import { EVENT_TRANSLATED } from './form-model';
import type { EventFormValues } from './schemas';

type Schemas = components['schemas'];

/** The start as UTC. The form's schema refused anything that is not one instant. */
function startsAtOf(values: EventFormValues): string {
  const start = instantFromWallTime(values, values.timezone);
  if (start.kind !== 'instant') throw new Error(`The form let through a ${start.kind} start`);
  return start.iso;
}

/**
 * A blank hosts label is left out, so the title stands in; the backend would refuse it. A blank
 * end or side is left out too, which the backend stores as none.
 */
export function createPayload(values: EventFormValues): Schemas['CreateEventDto'] {
  const endsAt = endsAtOf(values);
  return {
    type: values.type,
    title: values.title,
    ...(values.hostsLabel ? { hostsLabel: values.hostsLabel } : {}),
    startsAt: startsAtOf(values),
    timezone: values.timezone,
    locales: values.locales,
    defaultLocale: values.defaultLocale,
    ...(endsAt ? { endsAt } : {}),
    ...(values.sideALabel ? { sideALabel: values.sideALabel } : {}),
    ...(values.sideBLabel ? { sideBLabel: values.sideBLabel } : {}),
  };
}

/** The end as UTC, or `null` for none. The form's schema refused anything that is not one instant. */
function endsAtOf(values: EventFormValues): string | null {
  if (!values.endDate && !values.endTime) return null;
  const end = instantFromWallTime({ date: values.endDate, time: values.endTime }, values.timezone);
  if (end.kind !== 'instant') throw new Error(`The form let through a ${end.kind} end`);
  return end.iso;
}

/** A new zone moves a typed end with it, as it moves the start. */
function isEndEdited(initial: EventFormValues, values: EventFormValues): boolean {
  return (
    values.endDate !== initial.endDate ||
    values.endTime !== initial.endTime ||
    (values.timezone !== initial.timezone && values.endDate !== '')
  );
}

/** The words of the languages the form shows, against what is stored: one language whole, or `null`. */
function translationsEdited(values: EventFormValues, stored: unknown) {
  const shown = translatedLanguages(values.locales, values.defaultLocale, stored, EVENT_TRANSLATED);
  const edited = Object.fromEntries(
    shown.map((language) => [
      language,
      values.translations[language] ?? { title: '', hostsLabel: '' },
    ]),
  );
  return translationEdits(stored, edited, EVENT_TRANSLATED);
}

/** The end, the sides and the other languages: what only correcting shows (design PD-110). */
function detailEdits(
  initial: EventFormValues,
  values: EventFormValues,
  stored: unknown,
): Schemas['UpdateEventDto'] {
  const body: Schemas['UpdateEventDto'] = {};
  if (isEndEdited(initial, values)) body.endsAt = endsAtOf(values);
  if (values.sideALabel !== initial.sideALabel) body.sideALabel = values.sideALabel || null;
  if (values.sideBLabel !== initial.sideBLabel) body.sideBLabel = values.sideBLabel || null;
  const translations = translationsEdited(values, stored);
  if (Object.keys(translations).length > 0) body.translations = translations;
  return body;
}

function isSameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/** The event's own order, then any language added. */
function keptOrder(before: readonly string[], after: readonly string[]): string[] {
  return [
    ...before.filter((locale) => after.includes(locale)),
    ...after.filter((locale) => !before.includes(locale)),
  ];
}

function isStartEdited(initial: EventFormValues, values: EventFormValues): boolean {
  return (
    values.date !== initial.date ||
    values.time !== initial.time ||
    values.timezone !== initial.timezone
  );
}

/**
 * Only what the host changed (docs/API.md §6: omitted means unchanged), so an edit never writes
 * back a value someone else changed meanwhile. A new zone keeps the typed times, so the start and
 * end move with it. Languages are compared as a set: reordering them is not a change. An emptied
 * end or side is `null`, which clears it; `stored` is the event's `translations` as loaded.
 */
export function updatePayload(
  initial: EventFormValues,
  values: EventFormValues,
  stored: unknown,
): Schemas['UpdateEventDto'] {
  const body: Schemas['UpdateEventDto'] = {};
  if (values.type !== initial.type) body.type = values.type;
  if (values.title !== initial.title) body.title = values.title;
  if (values.hostsLabel !== initial.hostsLabel) body.hostsLabel = values.hostsLabel;
  if (isStartEdited(initial, values)) body.startsAt = startsAtOf(values);
  if (values.timezone !== initial.timezone) body.timezone = values.timezone;
  if (!isSameSet(initial.locales, values.locales)) {
    body.locales = keptOrder(initial.locales, values.locales);
  }
  if (values.defaultLocale !== initial.defaultLocale) body.defaultLocale = values.defaultLocale;
  return { ...body, ...detailEdits(initial, values, stored) };
}
