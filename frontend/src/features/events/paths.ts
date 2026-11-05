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

export function sheetsPath(eventId: string): string {
  return generatePath(APP_PATHS.sheets, { eventId });
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

export function runningOrderPath(eventId: string): string {
  return generatePath(APP_PATHS.runningOrder, { eventId });
}

export function eventVendorsPath(eventId: string): string {
  return generatePath(APP_PATHS.eventVendors, { eventId });
}

export function newBookingPath(eventId: string): string {
  return generatePath(APP_PATHS.newBooking, { eventId });
}

export function bookingPath(eventId: string, bookingId: string): string {
  return generatePath(APP_PATHS.booking, { eventId, bookingId });
}

export function recordAnswerPath(eventId: string, guestId: string): string {
  return generatePath(APP_PATHS.recordAnswer, { eventId, guestId });
}

export function recordHouseholdPath(eventId: string, householdId: string): string {
  return generatePath(APP_PATHS.recordHousehold, { eventId, householdId });
}
