import { expectData, type ApiClient } from '@/api/client';
import type { OffsetPage } from '@/ui/app-form';

import { readSuppressions } from './read';

import type { HostChannel, Suppression } from './types';

/** The most one page may hold (docs/API.md §1, paging). */
const SUPPRESSIONS_PAGE = 100;

/**
 * One page of the list, newest first (FR-99). Needs `guest:contact:read` in the organization: its
 * owner or a manager (docs/API.md §6).
 */
export async function listSuppressions(
  api: ApiClient,
  offset = 0,
): Promise<OffsetPage<Suppression>> {
  const wire = await expectData(
    api.GET('/api/v1/suppressions', {
      params: { query: { limit: SUPPRESSIONS_PAGE, offset } },
    }),
  );
  return {
    items: readSuppressions(wire.items),
    nextOffset: wire.hasMore ? offset + wire.items.length : null,
  };
}

/**
 * Needs `guest:write` in the organization. No reason is sent: the backend records `MANUAL`, the only
 * one a host may give (FR-99).
 */
export async function addSuppression(
  api: ApiClient,
  entry: { channel: HostChannel; address: string },
): Promise<void> {
  await expectData(api.POST('/api/v1/suppressions', { body: entry }));
}

export async function liftSuppression(api: ApiClient, suppressionId: string): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/suppressions/{suppressionId}', { params: { path: { suppressionId } } }),
  );
}
