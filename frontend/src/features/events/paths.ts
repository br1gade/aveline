import { generatePath } from 'react-router';

import { APP_PATHS } from '@/route-paths';

export function eventPath(eventId: string): string {
  return generatePath(APP_PATHS.event, { eventId });
}

export function editEventPath(eventId: string): string {
  return generatePath(APP_PATHS.editEvent, { eventId });
}
