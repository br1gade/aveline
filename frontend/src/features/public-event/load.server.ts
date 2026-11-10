import { createPublicApi } from '@/api/client';
import { isApiError } from '@/api/errors';
import { readServerEnv } from '@/config/env.server';

import { fetchPublicEvent, fetchPublicListing, type PublicEventRequest } from './api';
import type { ListingQuery } from './listing';
import type { PublicEvent, PublicListing } from './types';

/** A public event page's loader data. */
export type PublicEventPageData =
  | {
      state: 'found';
      event: PublicEvent;
      /** Sales stop when the event starts (docs/API.md §5); decided here, on the server's clock. */
      isSalesClosed: boolean;
    }
  | { state: 'not-found' };

/**
 * Loads a public event on the server, through the internal API address. A 404 (unpublished,
 * private, archived, never existed) is the not-found page; anything else goes to the error
 * boundary with its request id.
 */
export async function loadPublicEvent(request: PublicEventRequest): Promise<PublicEventPageData> {
  const api = createPublicApi(readServerEnv().API_INTERNAL_URL);
  try {
    const event = await fetchPublicEvent(api, request);
    return { state: 'found', event, isSalesClosed: Date.parse(event.startsAt) <= Date.now() };
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      return { state: 'not-found' };
    }
    throw error;
  }
}

/**
 * Browsing public events on the server, through the internal API address. A failure goes to the
 * error boundary with its request id. Every visitor counts against one address, within the
 * guest-page allowance the backend gave these reads (FR-73).
 */
export function loadPublicListing(
  query: ListingQuery & { locale: string },
): Promise<PublicListing> {
  return fetchPublicListing(createPublicApi(readServerEnv().API_INTERNAL_URL), query);
}
