import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import { readSuppressions } from './read';
import type { HostChannel, Suppression, SuppressionWire } from './types';

/** Needs `guest:contact:read` in the organization: its owner or a manager (docs/API.md §6). */
export async function listSuppressions(api: ApiClient): Promise<Suppression[]> {
  const wire = await expectData<SuppressionWire[]>(api.GET('/api/v1/suppressions'));
  return readSuppressions(wire);
}

/**
 * Needs `guest:write` in the organization. No reason is sent: the backend records `MANUAL`. The
 * schema declares no properties for this body (FR-99), so it is typed here, from the DTO.
 */
export async function addSuppression(
  api: ApiClient,
  entry: { channel: HostChannel; address: string },
): Promise<void> {
  const body = entry as unknown as components['schemas']['SuppressDto'];
  await expectData<unknown>(api.POST('/api/v1/suppressions', { body }));
}

export async function liftSuppression(api: ApiClient, suppressionId: string): Promise<void> {
  await expectData<unknown>(
    api.DELETE('/api/v1/suppressions/{suppressionId}', { params: { path: { suppressionId } } }),
  );
}
