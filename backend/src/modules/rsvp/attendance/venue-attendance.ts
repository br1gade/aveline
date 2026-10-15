import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockAttendancePolicy } from './attendance-context';
import { refreshVenueAttendance } from './attendance-writes';
import { GUEST_FACING_VENUES } from '../../design/guest-facing-venues';

/** A visibility edit cannot silently hide response or seating history. */
export async function mutateGuestVenues<T>(tx: Prisma.TransactionClient, eventId: string, write: () => Promise<T>): Promise<T> {
  const before = await lockAttendancePolicy(tx, eventId, true);
  const result = await write();
  const after = await tx.venue.findMany({ where: { eventId, ...GUEST_FACING_VENUES }, select: { id: true } });
  const ids = new Set(after.map((venue) => venue.id));
  const hidden = before.venues.filter((venue) => !ids.has(venue.id)).map((venue) => venue.id);
  if (hidden.length > 0) {
    const [responses, seats] = await Promise.all([
      tx.attendanceResponse.count({ where: { eventId, venueId: { in: hidden } } }),
      tx.seat.count({ where: { eventId, table: { venueId: { in: hidden } } } }),
    ]);
    if (responses + seats > 0) throw new ConflictException('venue: attendance or seats exist; keep the venue guest-facing to preserve history');
  }
  await refreshVenueAttendance(tx, eventId);
  return result;
}
