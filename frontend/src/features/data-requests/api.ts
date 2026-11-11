import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import { readCarried, readRequest, readSubmissions } from './read';
import type { Carried, DataRequest, RequestStatus, SubmissionsPage } from './types';

/** The public form's submissions a page reads at once (docs/API.md §6, default 20). */
const SUBMISSIONS_PAGE = 20;

/**
 * One status, soonest due, at most 200 (FR-127). `ADMIN` only (`privacy:manage`). The schema doesn't
 * declare the query, though the route reads it (FR-127).
 */
export async function listRequests(api: ApiClient, status: RequestStatus): Promise<DataRequest[]> {
  const rows = await expectData(
    api.GET('/api/v1/privacy/requests', { params: { query: { status } as never } }),
  );
  return rows.map(readRequest);
}

/** What the public form said for this request, oldest first: unverified, never evidence (FR-126). */
export async function listSubmissions(
  api: ApiClient,
  requestId: string,
  offset: number,
): Promise<SubmissionsPage> {
  return readSubmissions(
    await expectData(
      api.GET('/api/v1/privacy/requests/{requestId}/submissions', {
        params: { path: { requestId }, query: { limit: SUBMISSIONS_PAGE, offset } },
      }),
    ),
  );
}

export async function updateRequest(
  api: ApiClient,
  requestId: string,
  body: components['schemas']['UpdateDataSubjectRequestDto'],
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/privacy/requests/{requestId}', {
      params: { path: { requestId } },
      body,
    }),
  );
}

/**
 * An erasure can't be undone. An export keeps the request open: it can be made again if the file is
 * lost, until its delivery is confirmed (FR-128, docs/API.md §6).
 */
export async function carryOut(api: ApiClient, requestId: string): Promise<Carried> {
  const answer: unknown = await expectData(
    api.POST('/api/v1/privacy/requests/{requestId}/fulfil', { params: { path: { requestId } } }),
  );
  return readCarried(requestId, answer);
}

/** Closes an export once the requester has it; only the latest generation can be (409 otherwise). */
export async function confirmDelivery(
  api: ApiClient,
  requestId: string,
  generationId: string,
): Promise<void> {
  await expectData(
    api.POST('/api/v1/privacy/requests/{requestId}/confirm-delivery', {
      params: { path: { requestId } },
      body: { generationId },
    }),
  );
}

/** The original, which the docs say to treat as untrusted: it is only ever saved, never shown. */
export function privateFile(api: ApiClient, requestId: string, mediaId: string): Promise<Blob> {
  return expectData<Blob>(
    api.GET('/api/v1/privacy/requests/{requestId}/guest-media/{mediaId}/file', {
      params: { path: { requestId, mediaId } },
      parseAs: 'blob',
    }),
  );
}
