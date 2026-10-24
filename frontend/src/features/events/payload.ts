import type { components } from '@/api/schema';
import { instantFromWallTime } from '@/lib/time';

import type { EventFormValues } from './schemas';

type Schemas = components['schemas'];

/** The start as UTC. The form's schema refused anything that is not one instant. */
function startsAtOf(values: EventFormValues): string {
  const start = instantFromWallTime(values, values.timezone);
  if (start.kind !== 'instant') throw new Error(`The form let through a ${start.kind} start`);
  return start.iso;
}

/** A blank hosts label is left out, so the title stands in; the backend would store it (FR-25). */
export function createPayload(values: EventFormValues): Schemas['CreateEventDto'] {
  return {
    type: values.type,
    title: values.title,
    ...(values.hostsLabel ? { hostsLabel: values.hostsLabel } : {}),
    startsAt: startsAtOf(values),
    timezone: values.timezone,
    locales: values.locales,
    defaultLocale: values.defaultLocale,
  };
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
 * back a value someone else changed meanwhile. A new zone keeps the typed time, so the start moves
 * with it. Languages are compared as a set: reordering them is not a change.
 */
export function updatePayload(
  initial: EventFormValues,
  values: EventFormValues,
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
  return body;
}
