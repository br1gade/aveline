import { expectData, type ApiClient } from '@/api/client';

import type { PilotTotals } from './types';

/** `staff:manage`, so `ADMIN` only; anyone else gets 403 (docs/API.md, "Pilot totals"). */
export async function readPilotTotals(api: ApiClient): Promise<PilotTotals> {
  const { hosts, invitationsSent, guests, guestsReplied, guestsAttending, guestsCheckedIn } =
    await expectData(api.GET('/api/v1/staff/pilot-stats'));
  return { hosts, invitationsSent, guests, guestsReplied, guestsAttending, guestsCheckedIn };
}
