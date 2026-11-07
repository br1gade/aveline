import { wordsIn } from '@/lib/i18n';

import type { TimelineEntry, TimelineEntryWire } from './types';

function labelOf(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1].trim() !== '',
    ),
  );
}

/** Only the fields the page reads, in the API's order, never re-sorted. */
export function readEntries(wire: readonly TimelineEntryWire[]): TimelineEntry[] {
  return wire.map((entry) => ({
    id: entry.id,
    label: labelOf(entry.label),
    occursAt: entry.occursAt,
    sortOrder: entry.sortOrder,
    isInternal: entry.isInternal,
    venueId: entry.venue?.id ?? null,
    venueName: entry.venue?.name ?? null,
  }));
}

/** The label in the event's default language, else in the first language it has. */
export const labelIn = wordsIn;
