import type { ApiClient } from '@/api/client';
import { getEvent, type EventDetail } from '@/features/events';

import { readDeadline } from './api';

export interface DoorData {
  event: EventDetail;
}

/**
 * Only the event, for its zone and title. On a poor signal the page and the code field must not wait
 * for the whole guest list: the list, the counts and the agreements load inside the page, each
 * failing on its own (design PD-94).
 */
export async function loadDoor(api: ApiClient, eventId: string): Promise<DoorData> {
  return { event: await getEvent(api, eventId, readDeadline()) };
}
