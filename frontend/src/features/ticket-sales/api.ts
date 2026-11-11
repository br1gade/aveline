import { expectData, type ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import type { EventVisibility } from '@/features/events';

import { readListing, readTicketType } from './read';
import type {
  CreateTicketTypeBody,
  Listing,
  ListingBody,
  TicketType,
  UpdateTicketTypeBody,
} from './types';

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
  const types = await expectData(
    api.GET('/api/v1/events/{eventId}/ticket-types', { params: { path: { eventId } } }),
  );
  return types.map(readTicketType);
}

export async function createTicketType(
  api: ApiClient,
  eventId: string,
  body: CreateTicketTypeBody,
): Promise<void> {
  await expectData(
    api.POST('/api/v1/events/{eventId}/ticket-types', {
      params: { path: { eventId } },
      body,
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
      body,
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
      await expectData(
        api.GET('/api/v1/events/{eventId}/listing', { params: { path: { eventId } } }),
      ),
    );
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

/** Creates or edits it; omitted fields are left alone. */
export async function saveListing(
  api: ApiClient,
  eventId: string,
  body: ListingBody,
): Promise<void> {
  await expectData(
    api.PUT('/api/v1/events/{eventId}/listing', {
      params: { path: { eventId } },
      body,
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
