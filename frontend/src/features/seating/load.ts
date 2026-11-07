import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';
import { listGuests, type Household } from '@/features/guests';

import { listArrangements, listSeatingJobs, listTables } from './api';
import type { Arrangement, SeatingJob, SeatingTable } from './types';

export interface SeatingData {
  event: EventDetail;
  /** The plans; refused to a role without `seating:read` (an event `DESIGNER`). */
  arrangements: Loaded<Arrangement[]>;
  /** Every plan's tables in one read, so choosing another plan reads nothing again. */
  tables: Loaded<SeatingTable[]>;
  /** Who is coming, and the households' names for automatic seating's result (FR-55). */
  households: Loaded<Household[]>;
  /** The event's recent runs, to show each plan's last and follow one still going. */
  jobs: Loaded<SeatingJob[]>;
}

/**
 * The event and four reads in parallel (design PD-67). Only the event's own failure fails the page;
 * the guest list goes through its own reader, so no guest's token goes further.
 */
export async function loadSeating(api: ApiClient, eventId: string): Promise<SeatingData> {
  const [event, arrangements, tables, households, jobs] = await Promise.all([
    getEvent(api, eventId),
    loaded(listArrangements(api, eventId)),
    loaded(listTables(api, eventId)),
    loaded(listGuests(api, eventId)),
    loaded(listSeatingJobs(api, eventId)),
  ]);
  return { event, arrangements, tables, households, jobs };
}
