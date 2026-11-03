import { expectData, type ApiClient } from '@/api/client';

import { LISTING_PAGE_SIZE, type ListingQuery } from './listing';
import { readListing, readPublicEvent } from './read';
import type { PublicEvent, PublicListing } from './types';

export interface PublicEventRequest {
  slug: string;
  /** The language the switcher chose; without it the event's default (docs/API.md §1). */
  locale?: string | undefined;
}

/** `GET /public/events/:slug` (docs/API.md §5): the announcement, its tickets and checkout's rules. */
export async function fetchPublicEvent(
  api: ApiClient,
  request: PublicEventRequest,
): Promise<PublicEvent> {
  const wire = await expectData<unknown>(
    api.GET('/api/v1/public/events/{slug}', {
      params: {
        path: { slug: request.slug },
        query: request.locale ? { locale: request.locale } : {},
      },
    }),
  );
  return readPublicEvent(wire);
}

/**
 * `GET /public/events` (docs/API.md §5): `PUBLIC` events until they end, soonest first. `locale` is
 * negotiated against each event separately, and a card does not say which it got (FR-92).
 */
export async function fetchPublicListing(
  api: ApiClient,
  { offset, category, locale }: ListingQuery & { locale: string },
): Promise<PublicListing> {
  const wire = await expectData<unknown>(
    api.GET('/api/v1/public/events', {
      params: {
        query: { limit: LISTING_PAGE_SIZE, offset, locale, ...(category ? { category } : {}) },
      },
    }),
  );
  return readListing(wire);
}
