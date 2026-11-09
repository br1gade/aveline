import type { ApiClient } from '@/api/client';
import { readEveryPage, type EveryPage } from '@/api/every-page';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';

import { listEventGallery } from './api';
import type { GalleryPhoto } from './types';

/** A stand-in until FR-47 is answered: at 100 a page, the event's 1,000 photos are ten reads. */
const MAX_GALLERY_PAGES = 11;

export interface HostGallery extends EveryPage<GalleryPhoto> {
  /** Whether guests can share new photos (FR-46). */
  uploadsEnabled: boolean;
}

export interface ModerationData {
  event: EventDetail;
  /** Every photo, or that this role may not moderate (403: `guest:write`). */
  photos: Loaded<HostGallery>;
}

async function readHostGallery(api: ApiClient, eventId: string): Promise<HostGallery> {
  let isUploadsEnabled = false;
  const every = await readEveryPage(async (after) => {
    const page = await listEventGallery(api, eventId, after);
    isUploadsEnabled = page.uploadsEnabled;
    return { items: page.photos, nextCursor: page.nextCursor };
  }, MAX_GALLERY_PAGES);
  return { ...every, uploadsEnabled: isUploadsEnabled };
}

/**
 * The event and its whole gallery in parallel (design PD-65). The list has no status filter (FR-47),
 * so it is read whole and sorted into tabs on the page. Only the event's own failure fails the page.
 */
export async function loadModeration(api: ApiClient, eventId: string): Promise<ModerationData> {
  const [event, photos] = await Promise.all([
    getEvent(api, eventId),
    loaded(readHostGallery(api, eventId)),
  ]);
  return { event, photos };
}
