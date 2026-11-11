import { expectData, type ApiClient } from '@/api/client';

import type { components } from '@/api/schema';

import type { TableUpdate } from './payload';

import { readArrangements, readJob, readTables } from './read';

import type { Arrangement, SeatingJob, SeatingTable } from './types';

type Schemas = components['schemas'];

/** Every venue's plan and the one that names no venue, a bare array (docs/API.md §6). */
export async function listArrangements(api: ApiClient, eventId: string): Promise<Arrangement[]> {
  const wire = await expectData(
    api.GET('/api/v1/events/{eventId}/seating/arrangements', { params: { path: { eventId } } }),
  );
  return readArrangements(wire);
}

/** Every plan's tables in one read, with who sits at each and the seats declines freed. */
export async function listTables(api: ApiClient, eventId: string): Promise<SeatingTable[]> {
  const wire = await expectData(
    api.GET('/api/v1/events/{eventId}/tables', { params: { path: { eventId } } }),
  );
  return readTables(wire);
}

/** Its answer is not read: the page reloads and shows what the server stored. */
export async function createTable(
  api: ApiClient,
  eventId: string,
  body: Schemas['CreateTableDto'],
): Promise<void> {
  await expectData(
    api.POST('/api/v1/events/{eventId}/tables', { params: { path: { eventId } }, body }),
  );
}

/** Numbered after the highest number already used with the name; answers `{ created }`. */
export async function createTables(
  api: ApiClient,
  eventId: string,
  body: Schemas['CreateTablesDto'],
): Promise<number> {
  const { created } = await expectData(
    api.POST('/api/v1/events/{eventId}/tables/bulk', { params: { path: { eventId } }, body }),
  );
  return created;
}

/** Omitted fields are unchanged; `null` clears the zone. */
export async function updateTable(
  api: ApiClient,
  eventId: string,
  tableId: string,
  body: TableUpdate,
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/events/{eventId}/tables/{tableId}', {
      params: { path: { eventId, tableId } },
      body,
    }),
  );
}

/** Refused with 409 while anyone sits at it. */
export async function deleteTable(api: ApiClient, eventId: string, tableId: string): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/events/{eventId}/tables/{tableId}', {
      params: { path: { eventId, tableId } },
    }),
  );
}

/** Seats a guest, or moves them within the table's own plan; their other venues' seats stay. */
export async function assignSeat(
  api: ApiClient,
  eventId: string,
  body: { guestId: string; tableId: string; position?: number },
): Promise<void> {
  await expectData(
    api.POST('/api/v1/events/{eventId}/seats', { params: { path: { eventId } }, body }),
  );
}

/**
 * Removes the seat, or the note that a decline freed one, in this plan only. The plan is always
 * named: omitting it is a 400 once more than one plan is in use (docs/API.md §6).
 */
export async function unassignSeat(
  api: ApiClient,
  eventId: string,
  guestId: string,
  arrangementId: string,
): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/events/{eventId}/seats/{guestId}', {
      params: { path: { eventId, guestId }, query: { arrangementId } },
    }),
  );
}

/** Queues a run; its key makes a repeat of the same press return the same run. */
export async function startAutoSeating(
  api: ApiClient,
  eventId: string,
  arrangementId: string,
  idempotencyKey: string,
): Promise<SeatingJob> {
  const wire = await expectData(
    api.POST('/api/v1/events/{eventId}/seats/auto-assign', {
      params: { path: { eventId }, query: { arrangementId } },
      body: { idempotencyKey },
    }),
  );
  return readJob(wire);
}

/** The event's newest fifty runs, newest first, without their results. */
export async function listSeatingJobs(api: ApiClient, eventId: string): Promise<SeatingJob[]> {
  const wire = await expectData(
    api.GET('/api/v1/events/{eventId}/seating/jobs', { params: { path: { eventId } } }),
  );
  return wire.map(readJob);
}

export async function getSeatingJob(
  api: ApiClient,
  eventId: string,
  jobId: string,
): Promise<SeatingJob> {
  const wire = await expectData(
    api.GET('/api/v1/events/{eventId}/seating/jobs/{jobId}', {
      params: { path: { eventId, jobId } },
    }),
  );
  return readJob(wire);
}

/** Lets each guest see their household's tables on their personal link; `true` to show them. */
export async function setSeatingPublished(
  api: ApiClient,
  eventId: string,
  isPublished: boolean,
): Promise<string | null> {
  const call = isPublished
    ? api.POST('/api/v1/events/{eventId}/seating/publish', { params: { path: { eventId } } })
    : api.POST('/api/v1/events/{eventId}/seating/unpublish', { params: { path: { eventId } } });
  const { seatingPublishedAt } = await expectData(call);
  return seatingPublishedAt;
}
