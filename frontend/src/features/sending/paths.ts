import { generatePath } from 'react-router';

import { APP_PATHS } from '@/route-paths';

import type { DeliveryGroup } from './delivery';

/** The guest list, filtered to one invitation group when given (`?invite=`, design PD-48). */
export function guestListPath(eventId: string, group?: DeliveryGroup): string {
  const path = generatePath(APP_PATHS.guests, { eventId });
  return group ? `${path}?invite=${group}` : path;
}

export function invitationPath(eventId: string): string {
  return generatePath(APP_PATHS.invitation, { eventId });
}
