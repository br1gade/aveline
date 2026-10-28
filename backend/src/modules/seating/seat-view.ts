import { ATTENDANCE_GUEST, isAttendanceReservation } from '../rsvp/attendance/attendance-view';
import { Prisma } from '@prisma/client';
import { translatedField } from '../../common/field-translations';

export const SEAT_DETAIL = {
  guest: { select: ATTENDANCE_GUEST },
  table: { select: { id: true, name: true, venueId: true, venue: { select: { name: true, translations: true } } } },
} satisfies Prisma.SeatInclude;

type DetailedSeat = Prisma.SeatGetPayload<{ include: typeof SEAT_DETAIL }>;

/** A legacy single-table field must not silently choose between two venues. */
export function singleTable(seats: { table: { name: string } }[]): string | null {
  return seats.length === 1 ? seats[0].table.name : null;
}

export function seatingAssignments(seats: DetailedSeat[], locale?: string) {
  return seats.map((seat) => ({
    arrangementId: seat.arrangementId,
    venueId: seat.table.venueId,
    venue: venueName(seat.table.venue, locale),
    tableId: seat.table.id,
    table: seat.table.name,
    position: seat.position,
    isReservation: isAttendanceReservation(seat.guest, seat.table.venueId),
  })).sort((a, b) => a.arrangementId.localeCompare(b.arrangementId));
}

function venueName(venue: DetailedSeat['table']['venue'], locale?: string) {
  if (!venue) return null;
  if (!locale) return venue.name;
  return translatedField(venue.translations, locale, 'name') ?? venue.name;
}
