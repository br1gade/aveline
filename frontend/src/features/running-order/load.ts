import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';

import { listEntries } from './api';
import type { OrderVenue, TimelineEntry } from './types';

export interface RunningOrderData {
  event: EventDetail;
  /** The event's venues, in the host's order, to choose from and to judge which guests see. */
  venues: OrderVenue[];
  entries: Loaded<TimelineEntry[]>;
}

export async function loadRunningOrder(api: ApiClient, eventId: string): Promise<RunningOrderData> {
  const [event, entries] = await Promise.all([
    getEvent(api, eventId),
    loaded(listEntries(api, eventId)),
  ]);
  const venues = (event.venues ?? []).map(({ id, role, name }) => ({ id, role, name: name ?? '' }));
  return { event, venues, entries };
}
