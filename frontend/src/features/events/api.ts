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
 * The schema declares `archived`, `limit` and `offset` required on this list, though the backend
 * reads each as optional and refuses an empty `limit` (FR-17). None is sent: this is the one place
 * the declared type is overridden.
 */
const NO_DECLARED_QUERY = { query: {} } as {
  query: { archived: string; limit: string; offset: string };
};

/** Every event the caller can reach, soonest first: a plain array, not an envelope. */
export function listEvents(api: ApiClient): Promise<EventSummary[]> {
  return expectData<EventSummary[]>(api.GET('/api/v1/events', { params: NO_DECLARED_QUERY }));
}

/** Creates the event, its draft invitation and the caller's place on it, in one request. */
export function createEvent(api: ApiClient, body: Schemas['CreateEventDto']): Promise<EventDetail> {
  return expectData<EventDetail>(api.POST('/api/v1/events', { body }));
}

/** A 403 also means the event does not exist: the backend answers the same for both. */
export function getEvent(api: ApiClient, id: string): Promise<EventDetail> {
  return expectData<EventDetail>(api.GET('/api/v1/events/{id}', { params: { path: { id } } }));
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
