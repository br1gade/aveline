import { expectData, type ApiClient } from '@/api/client';

/**
 * What each row uses, interim until FR-1. An entry also names its request and its account, which the
 * page doesn't.
 */
export interface ActivityEntry {
  method: string;
  route: string;
  /** `null` once the person's address is erased (`AuditService.forgetPerson`), when a row names no one. */
  email: string | null;
  at: string;
}

/** Needs `member:manage`, because it names who did what (docs/API.md §6). Newest first, up to 100. */
export async function getActivity(api: ApiClient, eventId: string): Promise<ActivityEntry[]> {
  const entries = await expectData<ActivityEntry[]>(
    api.GET('/api/v1/events/{id}/audit-trail', { params: { path: { id: eventId } } }),
  );
  return entries.map(({ method, route, email, at }) => ({ method, route, email, at }));
}
