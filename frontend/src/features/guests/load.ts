import type { ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import { getEvent, type EventDetail } from '@/features/events';

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
}

/** The event and its guests in parallel. Only the event's own failure, or a 5xx, fails the page. */
export async function loadGuestList(api: ApiClient, eventId: string): Promise<GuestListData> {
  const [event, households] = await Promise.all([
    getEvent(api, eventId),
    unlessRefused(listGuests(api, eventId)),
  ]);
  return { event, households };
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
