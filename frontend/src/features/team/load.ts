import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';

import { getTeam } from './api';
import type { Team } from './types';

export interface TeamPageData {
  event: EventDetail;
  /** Refused to anyone without `member:manage`, who can read the event all the same. */
  team: Loaded<Team>;
}

export async function loadTeamPage(api: ApiClient, eventId: string): Promise<TeamPageData> {
  const [event, team] = await Promise.all([getEvent(api, eventId), loaded(getTeam(api, eventId))]);
  return { event, team };
}
