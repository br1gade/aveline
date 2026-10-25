import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import { readHouseholds, readImportHistory, readImportResult } from './read';
import type {
  Household,
  HouseholdWire,
  ImportRecord,
  ImportRecordWire,
  ImportResult,
  ImportResultWire,
  RemovedWire,
} from './types';

type Schemas = components['schemas'];

/** Every household and guest, read where it arrives: no token goes further (`read.ts`). */
export async function listGuests(api: ApiClient, eventId: string): Promise<Household[]> {
  const households = await expectData<HouseholdWire[]>(
    api.GET('/api/v1/events/{eventId}/guests', { params: { path: { eventId } } }),
  );
  return readHouseholds(households);
}

/**
 * Resolves to nothing. The response carries the new guest's token whatever the caller may see
 * (FR-29), so it is not read; the list reloads instead, and shows what the server stored.
 */
export async function addGuest(
  api: ApiClient,
  eventId: string,
  body: Schemas['AddGuestDto'],
): Promise<void> {
  await expectData<unknown>(
    api.POST('/api/v1/events/{eventId}/guests', { params: { path: { eventId } }, body }),
  );
}

/** Omitted fields are unchanged; `householdId` moves the guest. Resolves to nothing, as adding does. */
export async function updateGuest(
  api: ApiClient,
  eventId: string,
  guestId: string,
  body: Schemas['UpdateGuestDto'],
): Promise<void> {
  await expectData<unknown>(
    api.PATCH('/api/v1/events/{eventId}/guests/{guestId}', {
      params: { path: { eventId, guestId } },
      body,
    }),
  );
}

/** Their answer and seat go with them; a household left empty goes too. */
export async function removeGuest(
  api: ApiClient,
  eventId: string,
  guestId: string,
): Promise<{ isHouseholdRemoved: boolean }> {
  const removed = await expectData<RemovedWire>(
    api.DELETE('/api/v1/events/{eventId}/guests/{guestId}', {
      params: { path: { eventId, guestId } },
    }),
  );
  return { isHouseholdRemoved: removed.isHouseholdRemoved };
}

export async function updateHousehold(
  api: ApiClient,
  eventId: string,
  householdId: string,
  body: Schemas['UpdateHouseholdDto'],
): Promise<void> {
  await expectData<unknown>(
    api.PATCH('/api/v1/events/{eventId}/households/{householdId}', {
      params: { path: { eventId, householdId } },
      body,
    }),
  );
}

/**
 * One multipart field, `file`. The schema types it as a string (`format: binary`), so the body
 * is the form data itself, through `bodySerializer`; the browser then sets the boundary. A partial
 * import is a 201, not an error.
 */
export async function importGuests(
  api: ApiClient,
  eventId: string,
  file: File,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  const result = await expectData<ImportResultWire>(
    api.POST('/api/v1/events/{eventId}/guests/import', {
      params: { path: { eventId } },
      body: {},
      bodySerializer: () => form,
    }),
  );
  return readImportResult(result);
}

/** The last twenty, newest first. */
export async function listImports(api: ApiClient, eventId: string): Promise<ImportRecord[]> {
  const records = await expectData<ImportRecordWire[]>(
    api.GET('/api/v1/events/{eventId}/guests/imports', { params: { path: { eventId } } }),
  );
  return readImportHistory(records);
}
