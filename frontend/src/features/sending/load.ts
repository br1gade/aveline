import type { ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';
import { getEvent, type EventDetail } from '@/features/events';

import { getDelivery, getDesignStatus } from './api';
import type { DeliveryReport, DesignStatus } from './types';

/**
 * A part of a page that loads on its own: ready, refused to this role (a 403), or failed, which
 * leaves the rest of the page standing and says why.
 */
export type Loaded<T> =
  { kind: 'ready'; value: T } | { kind: 'refused' } | { kind: 'failed'; problem: Problem };

async function loaded<T>(load: Promise<T>): Promise<Loaded<T>> {
  try {
    return { kind: 'ready', value: await load };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return error.status === 403
      ? { kind: 'refused' }
      : { kind: 'failed', problem: problemFrom(error) };
  }
}

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
