import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';
import type { CursorPage } from '@/ui/app-form';

import { readCarried, readRequest, readSubmissions } from './read';
import type { Carried, DataRequest, RequestStatus, SubmissionsPage } from './types';

/** The public form's submissions a page reads at once (docs/API.md §6, default 20). */
const SUBMISSIONS_PAGE = 20;

/** Which part of the queue a read asks for (docs/API.md §6). */
export interface RequestQuery {
  queue: 'OPEN' | 'CLOSED';
  /** Narrows the queue; a status of the other queue is refused. */
  status?: RequestStatus;
}

/** A page the backend's default size. */
const PAGE_SIZE = 50;

/**
 * A page of the queue, in the backend's order: open ones soonest due first, closed ones newest
 * completed first (FR-127). `ADMIN` only (`privacy:manage`).
 */
export async function listRequests(
  api: ApiClient,
  query: RequestQuery,
  cursor?: string,
): Promise<CursorPage<DataRequest>> {
  const page = await expectData(
    api.GET('/api/v1/privacy/requests/page', {
      params: { query: { ...query, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
    }),
  );
  return { items: page.items.map(readRequest), nextCursor: page.nextCursor };
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
  return expectData(
    api.GET('/api/v1/privacy/requests/{requestId}/guest-media/{mediaId}/file', {
      params: { path: { requestId, mediaId } },
      parseAs: 'blob',
    }),
  );
}
