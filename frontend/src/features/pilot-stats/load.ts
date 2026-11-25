import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';

import { readPilotTotals } from './api';
import type { PilotTotals } from './types';

export interface PilotStatsData {
  /** Refused to anyone but Aveline's administrators. */
  totals: Loaded<PilotTotals>;
}

export async function loadPilotStats(api: ApiClient): Promise<PilotStatsData> {
  return { totals: await loaded(readPilotTotals(api)) };
}
