import { expectData, type ApiClient } from '@/api/client';

import type { EventSummary } from './types';

/**
 * The schema declares `archived`, `limit` and `offset` required on this list, though the backend
 * reads each as optional and refuses an empty `limit` (FR-17). None is sent: this is the one place
 * the declared type is overridden.
 */
const NO_DECLARED_QUERY = { query: {} } as {
  query: { archived: string; limit: string; offset: string };
};

/** Every event the caller can reach, soonest first: a plain array, not an envelope. */
export function listEvents(api: ApiClient): Promise<EventSummary[]> {
  return expectData<EventSummary[]>(api.GET('/api/v1/events', { params: NO_DECLARED_QUERY }));
}
