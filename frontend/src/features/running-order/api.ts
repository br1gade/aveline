import { expectData, type ApiClient } from '@/api/client';

import type { components } from '@/api/schema';

import { readEntries } from './read';

import type { TimelineEntry } from './types';

type Schemas = components['schemas'];

/** Reading needs `event:read`; every write `event:write` (docs/API.md §6). */
export async function listEntries(api: ApiClient, eventId: string): Promise<TimelineEntry[]> {
  const wire = await expectData(
    api.GET('/api/v1/events/{eventId}/timeline', { params: { path: { eventId } } }),
  );
  return readEntries(wire);
}

/** Returns the stored row, without its venue (FR-94); the page reloads the list instead. */
export async function addEntry(
  api: ApiClient,
  eventId: string,
  body: Schemas['UpsertTimelineEntryDto'],
): Promise<void> {
  await expectData(
    api.POST('/api/v1/events/{eventId}/timeline', { params: { path: { eventId } }, body }),
  );
}

export async function updateEntry(
  api: ApiClient,
  eventId: string,
  entryId: string,
  body: Schemas['UpdateTimelineEntryDto'],
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/events/{eventId}/timeline/{entryId}', {
      params: { path: { eventId, entryId } },
      body,
    }),
  );
}

export async function removeEntry(api: ApiClient, eventId: string, entryId: string): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/events/{eventId}/timeline/{entryId}', {
      params: { path: { eventId, entryId } },
    }),
  );
}
