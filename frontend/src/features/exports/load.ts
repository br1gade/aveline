import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';

import { listLegacyExports, listSnapshots } from './api';
import type { LegacyExport, Snapshot } from './types';

export interface ExportsData {
  event: EventDetail;
  /** The newest fifty snapshots; refused to a role without `operations:read` (a `DESIGNER`). */
  snapshots: Loaded<Snapshot[]>;
  /** Records from before snapshots, to be made again (design PD-77). */
  legacy: Loaded<LegacyExport[]>;
}

/** The event and both histories in parallel; only the event's own failure fails the page. */
export async function loadExports(api: ApiClient, eventId: string): Promise<ExportsData> {
  const [event, snapshots, legacy] = await Promise.all([
    getEvent(api, eventId),
    loaded(listSnapshots(api, eventId)),
    loaded(listLegacyExports(api, eventId)),
  ]);
  return { event, snapshots, legacy };
}
