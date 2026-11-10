import { expectData, type ApiClient } from '@/api/client';
import { loaded } from '@/api/loaded';

import type { Granted } from './types';

/**
 * A refusal or failure leaves nothing known, so a page offers what it offered before the read
 * existed and the action's own 403 is worded (design PD-190).
 */
async function grantedBy(read: Promise<{ permissions: Granted }>): Promise<Granted> {
  const access = await loaded(read);
  return access.kind === 'ready' ? access.value.permissions : null;
}

/** The caller's permissions on one event (`GET /events/:id/access`, FR-6). */
export function readEventAccess(api: ApiClient, eventId: string): Promise<Granted> {
  return grantedBy(
    expectData(api.GET('/api/v1/events/{id}/access', { params: { path: { id: eventId } } })),
  );
}

/** The caller's permissions in the organization this tab works in (FR-6). */
export function readOrganizationAccess(api: ApiClient): Promise<Granted> {
  return grantedBy(expectData(api.GET('/api/v1/organizations/current/access')));
}
