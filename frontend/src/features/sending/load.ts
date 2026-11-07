import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';

import { getDelivery, getDesignStatus } from './api';
import type { DeliveryReport, DesignStatus } from './types';

export type { Loaded };

/**
 * The delivery report, once the invitation has been published: a draft has sent nothing, and its
 * report would say only that. `null` when there is no report to read.
 */
export function loadDelivery(
  api: ApiClient,
  event: EventDetail,
): Promise<Loaded<DeliveryReport>> | null {
  const { invitation } = event;
  if (!invitation || invitation.status === 'DRAFT') return null;
  return loaded(getDelivery(api, invitation.slug));
}

export interface InvitationPageData {
  event: EventDetail;
  /** While a draft: what blocks publishing. */
  draft: Loaded<DesignStatus> | null;
  /** Once published or closed: who was invited. */
  delivery: Loaded<DeliveryReport> | null;
}

/** The event first, for its invitation's link name; then what that invitation's state needs. */
export async function loadInvitationPage(
  api: ApiClient,
  eventId: string,
): Promise<InvitationPageData> {
  const event = await getEvent(api, eventId);
  const { invitation } = event;
  const draft =
    invitation?.status === 'DRAFT' ? await loaded(getDesignStatus(api, invitation.slug)) : null;
  return { event, draft, delivery: await loadDelivery(api, event) };
}
