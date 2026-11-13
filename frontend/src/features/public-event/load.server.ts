import { createVisitorApi } from '@/api/visitor.server';
import { isApiError } from '@/api/errors';

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
export async function loadPublicEvent(
  request: PublicEventRequest,
  incoming: Request,
): Promise<PublicEventPageData> {
  const api = createVisitorApi(incoming);
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
 * error boundary with its request id. Each visitor counts against their own address, within
 * the guest-page allowance the backend gave these reads (FR-73).
 */
export function loadPublicListing(
  query: ListingQuery & { locale: string },
  incoming: Request,
): Promise<PublicListing> {
  return fetchPublicListing(createVisitorApi(incoming), query);
}
