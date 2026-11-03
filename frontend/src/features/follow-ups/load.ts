import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';
import { listGuests, type Household } from '@/features/guests';
import { loadDelivery, type DeliveryReport } from '@/features/sending';

export interface FollowUpsData {
  event: EventDetail;
  /** `null` while there is nothing to work out: no invitation, or a draft nobody holds. */
  guests: Loaded<Household[]> | null;
  delivery: Loaded<DeliveryReport> | null;
  /** When this was read: a reload after a refusal moves it, so the page follows the event's start. */
  now: number;
}

/**
 * The event, then the two reads "who gets it" is worked out from (FR-84). Each fails on its own:
 * a role refused them can still press, and is told when it does (FR-6).
 */
export async function loadFollowUps(api: ApiClient, eventId: string): Promise<FollowUpsData> {
  const now = Date.now();
  const event = await getEvent(api, eventId);
  if (!event.invitation || event.invitation.status === 'DRAFT') {
    return { event, guests: null, delivery: null, now };
  }
  const [guests, delivery] = await Promise.all([
    loaded(listGuests(api, eventId)),
    loadDelivery(api, event),
  ]);
  return { event, guests, delivery, now };
}
