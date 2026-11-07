import { wallTimeOf } from '@/lib/time';

import type { EntryFormValues } from './schemas';
import type { TimelineEntry } from './types';

/** The event's languages, then any other an entry already has, so an edit never hides one. */
export function entryLanguages(eventLocales: readonly string[], entry?: TimelineEntry): string[] {
  const extra = Object.keys(entry?.label ?? {}).filter((code) => !eventLocales.includes(code));
  return [...eventLocales, ...extra];
}

/** A new entry starts on the event's day, in its zone, with no time yet. */
export function newEntryValues(
  languages: readonly string[],
  eventStartsAt: string,
  timeZone: string,
): EntryFormValues {
  return {
    labels: Object.fromEntries(languages.map((code) => [code, ''])),
    date: wallTimeOf(eventStartsAt, timeZone).date,
    time: '',
    venueId: '',
    isInternal: false,
  };
}

/** An entry as the form shows it: its time read in the event's zone, never the device's. */
export function entryFormValues(
  entry: TimelineEntry,
  languages: readonly string[],
  timeZone: string,
): EntryFormValues {
  return {
    labels: Object.fromEntries(languages.map((code) => [code, entry.label[code] ?? ''])),
    ...wallTimeOf(entry.occursAt, timeZone),
    venueId: entry.venueId ?? '',
    isInternal: entry.isInternal,
  };
}
