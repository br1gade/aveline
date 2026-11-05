import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';

import { getActivity, type ActivityEntry } from './api';

export interface ActivityData {
  event: EventDetail;
  /** Refused to anyone who doesn't manage the event's team, who can read the event all the same. */
  entries: Loaded<ActivityEntry[]>;
}

export async function loadActivity(api: ApiClient, eventId: string): Promise<ActivityData> {
  const [event, entries] = await Promise.all([
    getEvent(api, eventId),
    loaded(getActivity(api, eventId)),
  ]);
  return { event, entries };
}
