import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import { readPage } from './read';
import type { AgreementsPage, AgreementsWire } from './types';

/** The most one read returns (docs/API.md §11: 1–100). */
export const PAGE_SIZE = 100;

interface PageQuery {
  limit?: components['schemas']['Object'];
  after?: string;
}

/** The schema types `limit` as an object (FR-38), so the query goes through this one cast. */
function pageQuery(after: string | undefined): PageQuery {
  const query = after ? { limit: PAGE_SIZE, after } : { limit: PAGE_SIZE };
  return query as unknown as PageQuery;
}

/** Newest first; needs `guest:contact:read`, which a designer and a read-only role lack. */
export async function listAgreements(
  api: ApiClient,
  eventId: string,
  after?: string,
): Promise<AgreementsPage> {
  const wire = await expectData<AgreementsWire>(
    api.GET('/api/v1/events/{eventId}/acknowledgements', {
      params: { path: { eventId }, query: pageQuery(after) },
    }),
  );
  return readPage(wire);
}

/** A drawn agreement's image; the bearer token cannot go in an `<img src>` (`PrivateImage`). */
export function agreementFile(
  api: ApiClient,
  eventId: string,
  acknowledgementId: string,
  signal: AbortSignal,
): Promise<Blob> {
  return expectData<Blob>(
    api.GET('/api/v1/events/{eventId}/acknowledgements/{acknowledgementId}/file', {
      params: { path: { eventId, acknowledgementId } },
      parseAs: 'blob',
      signal,
    }),
  );
}
