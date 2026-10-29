import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';

import { listEventGallery } from './api';
import { readEveryPage, type EveryPage } from './pages';
import type { GalleryPhoto } from './types';

export interface ModerationData {
  event: EventDetail;
  /** Every photo, or that this role may not moderate (403: `guest:write`). */
  photos: Loaded<EveryPage<GalleryPhoto>>;
}

/**
 * The event and its whole gallery in parallel (design PD-65). The list has no status filter (FR-47),
 * so it is read whole and sorted into tabs on the page. Only the event's own failure fails the page.
 */
export async function loadModeration(api: ApiClient, eventId: string): Promise<ModerationData> {
  const [event, photos] = await Promise.all([
    getEvent(api, eventId),
    loaded(readEveryPage((after) => listEventGallery(api, eventId, after))),
  ]);
  return { event, photos };
}
