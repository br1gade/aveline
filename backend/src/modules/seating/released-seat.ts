import { Prisma } from '@prisma/client';

/** A decline releases only its attendance scope; event-wide releases every arrangement. */
export async function releaseSeat(tx: Prisma.TransactionClient, guestId: string, venueIds?: string[]): Promise<void> {
  const where = { guestId, ...(venueIds ? { table: { venueId: { in: venueIds } } } : {}) };
  const seats = await tx.seat.findMany({ where, select: { tableId: true, arrangementId: true, eventId: true } });
  if (seats.length === 0) return;
  const releasedAt = new Date();
  await tx.seat.deleteMany({ where });
  await tx.$executeRaw`
    INSERT INTO seat_releases (id, "guestId", "eventId", "arrangementId", "tableId", "releasedAt")
    VALUES ${Prisma.join(seats.map((seat) => Prisma.sql`(${`${guestId}:${seat.arrangementId}`}, ${guestId}, ${seat.eventId}, ${seat.arrangementId}, ${seat.tableId}, ${releasedAt})`))}
    ON CONFLICT ("guestId", "arrangementId") DO UPDATE SET "tableId" = EXCLUDED."tableId", "releasedAt" = EXCLUDED."releasedAt"`;
}

export async function clearRelease(tx: Prisma.TransactionClient, guestIds: string[], arrangementId: string) {
  await tx.seatRelease.deleteMany({ where: { guestId: { in: guestIds }, arrangementId } });
}
