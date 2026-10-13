import { Prisma } from '@prisma/client';

/** An event-wide decline releases every arrangement without collapsing its history. */
export async function releaseSeat(tx: Prisma.TransactionClient, guestId: string): Promise<void> {
  const seats = await tx.seat.findMany({ where: { guestId }, select: { tableId: true, arrangementId: true, eventId: true } });
  if (seats.length === 0) return;
  const releasedAt = new Date();
  await tx.seat.deleteMany({ where: { guestId } });
  await tx.seatRelease.createMany({ data: seats.map((seat) => ({ ...seat, guestId, releasedAt })) });
}

export async function clearRelease(tx: Prisma.TransactionClient, guestIds: string[], arrangementId: string) {
  await tx.seatRelease.deleteMany({ where: { guestId: { in: guestIds }, arrangementId } });
}
