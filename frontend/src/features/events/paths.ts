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

export function designPath(eventId: string): string {
  return generatePath(APP_PATHS.design, { eventId });
}

export function photosPath(eventId: string): string {
  return generatePath(APP_PATHS.photos, { eventId });
}

export function agreementsPath(eventId: string): string {
  return generatePath(APP_PATHS.agreements, { eventId });
}

export function seatingPath(eventId: string): string {
  return generatePath(APP_PATHS.seating, { eventId });
}

export function exportsPath(eventId: string): string {
  return generatePath(APP_PATHS.exports, { eventId });
}

export function ticketSalesPath(eventId: string): string {
  return generatePath(APP_PATHS.ticketSales, { eventId });
}

export function ordersPath(eventId: string): string {
  return generatePath(APP_PATHS.orders, { eventId });
}

export function doorPath(eventId: string): string {
  return generatePath(APP_PATHS.door, { eventId });
}

export function followUpsPath(eventId: string): string {
  return generatePath(APP_PATHS.followUps, { eventId });
}

export function teamPath(eventId: string): string {
  return generatePath(APP_PATHS.team, { eventId });
}
