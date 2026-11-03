import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import {
  readChanged,
  readPreview,
  type AttendanceChanged,
  type AttendancePreview,
  type ChangedWire,
  type PreviewWire,
} from './attendance';
import type {
  AttendanceMode,
  Dashboard,
  EventDetail,
  EventSummary,
  EventUpdated,
  NotifyResult,
} from './types';

type Schemas = components['schemas'];

/**
 * Every event the caller can reach, soonest first: a plain array, not an envelope. Archived events
 * are left out, unless `isArchiveWanted` asks for them, and then they alone are listed.
 */
export function listEvents(
  api: ApiClient,
  options: { isArchiveWanted?: boolean } = {},
): Promise<EventSummary[]> {
  const query = options.isArchiveWanted ? { params: { query: { archived: true } } } : {};
  return expectData<EventSummary[]>(api.GET('/api/v1/events', query));
}

/** Always allowed, and reversible: replies stop, the listing comes down. Needs `event:delete`. */
export async function archiveEvent(api: ApiClient, id: string): Promise<void> {
  await expectData<unknown>(api.POST('/api/v1/events/{id}/archive', { params: { path: { id } } }));
}

/** The event's status comes back; its invitation stays closed until it is reopened. */
export async function unarchiveEvent(api: ApiClient, id: string): Promise<void> {
  await expectData<unknown>(
    api.POST('/api/v1/events/{id}/unarchive', { params: { path: { id } } }),
  );
}

/** For good, files included: only an event never published, through which no money moved. */
export async function deleteEvent(api: ApiClient, id: string): Promise<void> {
  await expectData<unknown>(api.DELETE('/api/v1/events/{id}', { params: { path: { id } } }));
}

/** Creates the event, its draft invitation and the caller's place on it, in one request. */
export function createEvent(api: ApiClient, body: Schemas['CreateEventDto']): Promise<EventDetail> {
  return expectData<EventDetail>(api.POST('/api/v1/events', { body }));
}

/** A 403 also means the event does not exist: the backend answers the same for both. */
export function getEvent(api: ApiClient, id: string, signal?: AbortSignal): Promise<EventDetail> {
  return expectData<EventDetail>(
    api.GET('/api/v1/events/{id}', { params: { path: { id } }, ...(signal ? { signal } : {}) }),
  );
}

/** Omitted fields are unchanged. The response carries `notice`, which the host acts on, or not. */
export function updateEvent(
  api: ApiClient,
  id: string,
  body: Schemas['UpdateEventDto'],
): Promise<EventUpdated> {
  return expectData<EventUpdated>(
    api.PATCH('/api/v1/events/{id}', { params: { path: { id } }, body }),
  );
}

/** Needs `operations:read`, which an event's designer does not hold. */
export function getDashboard(api: ApiClient, eventId: string): Promise<Dashboard> {
  return expectData<Dashboard>(
    api.GET('/api/v1/events/{eventId}/dashboard', { params: { path: { eventId } } }),
  );
}

/** What changing how guests answer would set back; refused with 400 `mode:` when it cannot. */
export async function previewAttendancePolicy(
  api: ApiClient,
  eventId: string,
  mode: AttendanceMode,
): Promise<AttendancePreview> {
  const preview = await expectData<PreviewWire>(
    api.POST('/api/v1/events/{eventId}/attendance-policy/preview', {
      params: { path: { eventId } },
      body: { mode },
    }),
  );
  return readPreview(preview);
}

/**
 * The previewed change. `transitionId` is made once per preview and sent again on a retry, so a
 * press repeated after a lost answer changes nothing twice.
 */
export async function changeAttendancePolicy(
  api: ApiClient,
  eventId: string,
  preview: AttendancePreview,
  transitionId: string,
): Promise<AttendanceChanged> {
  const { mode, expectedRevision, previewToken } = preview;
  const changed = await expectData<ChangedWire>(
    api.POST('/api/v1/events/{eventId}/attendance-policy', {
      params: { path: { eventId } },
      body: { mode, expectedRevision, previewToken, transitionId },
    }),
  );
  return readChanged(changed);
}

/** Only ever on the host's request (docs/API.md §6, "Telling guests the details changed"). */
export function notifyChanges(api: ApiClient, slug: string, note: string): Promise<NotifyResult> {
  const body = note ? { note } : {};
  return expectData<NotifyResult>(
    api.POST('/api/v1/invitations/{slug}/notify-changes', { params: { path: { slug } }, body }),
  );
}
