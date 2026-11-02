import { expectData, type ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import type { components } from '@/api/schema';
import type { EventVisibility } from '@/features/events';

import { readListing, readTicketType } from './read';
import type {
  CreateTicketTypeBody,
  Listing,
  ListingBody,
  TicketType,
  UpdateTicketTypeBody,
} from './types';

type Schemas = components['schemas'];

/**
 * Who can find the event (docs/API.md §5): `PRIVATE` takes the announcement down in the same act.
 * Needs `event:write`.
 */
export async function setVisibility(
  api: ApiClient,
  eventId: string,
  visibility: EventVisibility,
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/events/{id}/settings', {
      params: { path: { id: eventId } },
      body: { visibility },
    }),
  );
}

/** What is for sale, with sold, held and available counts; inactive types included. */
export async function listTicketTypes(api: ApiClient, eventId: string): Promise<TicketType[]> {
  const types = await expectData<unknown[]>(
    api.GET('/api/v1/events/{eventId}/ticket-types', { params: { path: { eventId } } }),
  );
  return types.map(readTicketType);
}

/**
 * The schema types names and descriptions as empty objects (FR-70, as FR-4); the bodies' real
 * types are in types.ts, and this is the one place they meet the generated ones.
 */
export async function createTicketType(
  api: ApiClient,
  eventId: string,
  body: CreateTicketTypeBody,
): Promise<void> {
  await expectData(
    api.POST('/api/v1/events/{eventId}/ticket-types', {
      params: { path: { eventId } },
      body: body as unknown as Schemas['CreateTicketTypeDto'],
    }),
  );
}

export async function updateTicketType(
  api: ApiClient,
  eventId: string,
  typeId: string,
  body: UpdateTicketTypeBody,
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/events/{eventId}/ticket-types/{typeId}', {
      params: { path: { eventId, typeId } },
      body: body as unknown as Schemas['UpdateTicketTypeDto'],
    }),
  );
}

/** Refused (409) once anything is sold or held against it, or it has checkout history. */
export async function deleteTicketType(
  api: ApiClient,
  eventId: string,
  typeId: string,
): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/events/{eventId}/ticket-types/{typeId}', {
      params: { path: { eventId, typeId } },
    }),
  );
}

/** The announcement, or `null` before it is first written (404). */
export async function getListing(api: ApiClient, eventId: string): Promise<Listing | null> {
  try {
    return readListing(
      await expectData<unknown>(
        api.GET('/api/v1/events/{eventId}/listing', { params: { path: { eventId } } }),
      ),
    );
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

/** Creates or edits it; omitted fields are left alone. The picture ids go through one cast (FR-70). */
export async function saveListing(
  api: ApiClient,
  eventId: string,
  body: ListingBody,
): Promise<void> {
  await expectData(
    api.PUT('/api/v1/events/{eventId}/listing', {
      params: { path: { eventId } },
      body: body as unknown as Schemas['UpsertListingDto'],
    }),
  );
}

export async function publishListing(api: ApiClient, eventId: string): Promise<void> {
  await expectData(
    api.POST('/api/v1/events/{eventId}/listing/publish', { params: { path: { eventId } } }),
  );
}

/** Tickets already sold are unaffected. */
export async function unpublishListing(api: ApiClient, eventId: string): Promise<void> {
  await expectData(
    api.POST('/api/v1/events/{eventId}/listing/unpublish', { params: { path: { eventId } } }),
  );
}
