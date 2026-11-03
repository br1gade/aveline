import type { components } from '@/api/schema';
import { labelEdits } from '@/lib/i18n';
import { instantFromWallTime } from '@/lib/time';

import { isSameMinute, sortOrderFor } from './order';
import type { EntryFormValues } from './schemas';
import type { TimelineEntry } from './types';

type Schemas = components['schemas'];

function occursAtOf(values: EntryFormValues, timeZone: string): string {
  const instant = instantFromWallTime(values, timeZone);
  if (instant.kind !== 'instant') throw new Error(`The form let through a ${instant.kind} time`);
  return instant.iso;
}

/** A new entry goes last among those at its minute; no venue is left out rather than sent empty. */
export function newEntryPayload(
  values: EntryFormValues,
  timeZone: string,
  entries: readonly TimelineEntry[],
): Schemas['UpsertTimelineEntryDto'] {
  const occursAt = occursAtOf(values, timeZone);
  return {
    label: labelEdits({}, values.labels),
    occursAt,
    ...(values.venueId ? { venueId: values.venueId } : {}),
    isInternal: values.isInternal,
    sortOrder: sortOrderFor(entries, occursAt),
  };
}

/**
 * Only what changed (docs/API.md §6: omitted is unchanged). The label goes one language at a time,
 * `null` removing one; a venue chosen away is `null`; an entry moved to another minute goes last
 * there.
 */
export function entryUpdatePayload(
  entry: TimelineEntry,
  initial: EntryFormValues,
  values: EntryFormValues,
  context: { timeZone: string; entries: readonly TimelineEntry[] },
): Schemas['UpdateTimelineEntryDto'] {
  const body: Schemas['UpdateTimelineEntryDto'] = {};
  const label = labelEdits(entry.label, values.labels);
  if (Object.keys(label).length > 0) body.label = label;
  if (values.date !== initial.date || values.time !== initial.time) {
    body.occursAt = occursAtOf(values, context.timeZone);
    if (!isSameMinute(body.occursAt, entry.occursAt)) {
      body.sortOrder = sortOrderFor(context.entries, body.occursAt);
    }
  }
  if (values.venueId !== initial.venueId) body.venueId = values.venueId || null;
  if (values.isInternal !== initial.isInternal) body.isInternal = values.isInternal;
  return body;
}
