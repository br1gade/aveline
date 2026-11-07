import { generatePath } from 'react-router';

import { APP_PATHS } from '@/route-paths';

export function answersSheetPath(eventId: string): string {
  return generatePath(APP_PATHS.answersSheet, { eventId });
}

export function guestBookPath(eventId: string): string {
  return generatePath(APP_PATHS.guestBook, { eventId });
}
