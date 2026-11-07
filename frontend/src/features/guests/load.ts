import type { ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import { getEvent, type EventDetail } from '@/features/events';
import { loadDelivery, type DeliveryReport, type Loaded } from '@/features/sending';

import { listGuests, listImports } from './api';
import type { Household, ImportRecord } from './types';

/**
 * What a page shows, or that this role may not see it. An event's `DESIGNER` may open the event but
 * not its guests (`guest:read`), and the page says so rather than failing whole.
 */
export type Readable<T> = { kind: 'ready'; value: T } | { kind: 'refused' };

async function unlessRefused<T>(load: Promise<T>): Promise<Readable<T>> {
  try {
    return { kind: 'ready', value: await load };
  } catch (error) {
    if (isApiError(error) && error.status === 403) return { kind: 'refused' };
    throw error;
  }
}

export interface GuestListData {
  event: EventDetail;
  households: Readable<Household[]>;
  /**
   * Who was invited, once the invitation is published (design PD-48); `null` for a draft. Its own
   * failure leaves the list standing.
   */
  delivery: Loaded<DeliveryReport> | null;
}

/**
 * The event and its guests in parallel, and the delivery report as soon as the event names its
 * invitation. Only the event's own failure, or the list's 5xx, fails the page.
 */
export async function loadGuestList(api: ApiClient, eventId: string): Promise<GuestListData> {
  const eventLoad = getEvent(api, eventId);
  const [event, households, delivery] = await Promise.all([
    eventLoad,
    unlessRefused(listGuests(api, eventId)),
    eventLoad.then((loaded) => loadDelivery(api, loaded)),
  ]);
  return { event, households, delivery };
}

export interface GuestImportsData {
  event: EventDetail;
  history: Readable<ImportRecord[]>;
}

export async function loadGuestImports(api: ApiClient, eventId: string): Promise<GuestImportsData> {
  const [event, history] = await Promise.all([
    getEvent(api, eventId),
    unlessRefused(listImports(api, eventId)),
  ]);
  return { event, history };
}
