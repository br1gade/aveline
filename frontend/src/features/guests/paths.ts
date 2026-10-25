import { generatePath } from 'react-router';

import { APP_PATHS } from '@/route-paths';

export function guestListPath(eventId: string): string {
  return generatePath(APP_PATHS.guests, { eventId });
}

export function importGuestsPath(eventId: string): string {
  return generatePath(APP_PATHS.importGuests, { eventId });
}
