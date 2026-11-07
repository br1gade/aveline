import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import { readCarried, readRequest } from './read';
import type { Carried, DataRequest, RequestStatus } from './types';

/**
 * One status, soonest due, at most 200 (FR-127). `ADMIN` only (`privacy:manage`). The schema doesn't
 * declare the query, though the route reads it (FR-127).
 */
export async function listRequests(api: ApiClient, status: RequestStatus): Promise<DataRequest[]> {
  const rows = await expectData<DataRequest[]>(
    api.GET('/api/v1/privacy/requests', { params: { query: { status } as never } }),
  );
  return rows.map(readRequest);
}

export async function updateRequest(
  api: ApiClient,
  requestId: string,
  body: components['schemas']['UpdateDataSubjectRequestDto'],
): Promise<void> {
  await expectData<unknown>(
    api.PATCH('/api/v1/privacy/requests/{requestId}', {
      params: { path: { requestId } },
      body,
    }),
  );
}

/** An export's answer is the only copy, and an erasure can't be undone (docs/API.md §6). */
export async function carryOut(api: ApiClient, requestId: string): Promise<Carried> {
  const answer = await expectData<unknown>(
    api.POST('/api/v1/privacy/requests/{requestId}/fulfil', { params: { path: { requestId } } }),
  );
  return readCarried(requestId, answer);
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
