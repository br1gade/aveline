import type { ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';

import { getDashboard, getEvent } from './api';
import type { EventDetail, Headcount } from './types';

/**
 * The overview's headcount, or why it is missing. A designer may open the event but not its
 * numbers (`operations:read`), and a failed dashboard should not hide the event itself.
 */
export type HeadcountResult =
  | { kind: 'ready'; headcount: Headcount }
  | { kind: 'refused' }
  | { kind: 'failed'; requestId: string | undefined };

export interface EventOverviewData {
  event: EventDetail;
  headcount: HeadcountResult;
}

async function headcountOf(api: ApiClient, eventId: string): Promise<HeadcountResult> {
  try {
    const { headcount } = await getDashboard(api, eventId);
    return { kind: 'ready', headcount };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return error.status === 403
      ? { kind: 'refused' }
      : { kind: 'failed', requestId: error.requestId };
  }
}

/** The event and its numbers in parallel. Only the event's own failure fails the page. */
export async function loadEventOverview(
  api: ApiClient,
  eventId: string,
): Promise<EventOverviewData> {
  const [event, headcount] = await Promise.all([getEvent(api, eventId), headcountOf(api, eventId)]);
  return { event, headcount };
}
