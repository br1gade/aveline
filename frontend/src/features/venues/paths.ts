import { generatePath } from 'react-router';

import { APP_PATHS } from '@/route-paths';

export function venuesPath(eventId: string): string {
  return generatePath(APP_PATHS.venues, { eventId });
}

export function newVenuePath(eventId: string): string {
  return generatePath(APP_PATHS.newVenue, { eventId });
}

export function editVenuePath(eventId: string, venueId: string): string {
  return generatePath(APP_PATHS.editVenue, { eventId, venueId });
}
