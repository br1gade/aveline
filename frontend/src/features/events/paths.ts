import { generatePath } from 'react-router';

import { APP_PATHS } from '@/route-paths';

export function eventPath(eventId: string): string {
  return generatePath(APP_PATHS.event, { eventId });
}

export function editEventPath(eventId: string): string {
  return generatePath(APP_PATHS.editEvent, { eventId });
}

export function guestListPath(eventId: string): string {
  return generatePath(APP_PATHS.guests, { eventId });
}

export function venuesPath(eventId: string): string {
  return generatePath(APP_PATHS.venues, { eventId });
}

export function invitationPath(eventId: string): string {
  return generatePath(APP_PATHS.invitation, { eventId });
}

export function attendancePath(eventId: string): string {
  return generatePath(APP_PATHS.attendance, { eventId });
}
