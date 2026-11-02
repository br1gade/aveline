import { expectData, type ApiClient } from '@/api/client';

import { readPublicEvent } from './read';
import type { PublicEvent } from './types';

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
  // The schema marks `locale` required, though the API treats it as optional (FR-17); an empty
  // value means "none" to the backend.
  const wire = await expectData<unknown>(
    api.GET('/api/v1/public/events/{slug}', {
      params: { path: { slug: request.slug }, query: { locale: request.locale ?? '' } },
    }),
  );
  return readPublicEvent(wire);
}
