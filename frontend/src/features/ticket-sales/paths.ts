import { generatePath } from 'react-router';

import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';

export function ticketSalesPath(eventId: string): string {
  return generatePath(APP_PATHS.ticketSales, { eventId });
}

export function newTicketTypePath(eventId: string): string {
  return generatePath(APP_PATHS.newTicketType, { eventId });
}

export function editTicketTypePath(eventId: string, typeId: string): string {
  return generatePath(APP_PATHS.editTicketType, { eventId, typeId });
}

export function announcementPath(eventId: string): string {
  return generatePath(APP_PATHS.announcement, { eventId });
}

/** The public page buyers open, at the address the backend builds (`metadata.canonicalPath`). */
export function publicEventPath(slug: string): string {
  return generatePath(ROUTE_PATHS.publicEvent, { slug });
}
