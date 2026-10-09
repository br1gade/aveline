import { Prisma } from '@prisma/client';

/**
 * A declined guest's seat, given back to the table — and remembered.
 *
 * Decided 9 October 2026: declining frees the seat automatically, so the
 * table's count is true, but the plan flags where it was. A host who placed
 * the family carefully needs to see the gap and why, not discover a chair
 * quietly free. The flag stays until the guest is seated again or the host
 * dismisses it.
 *
 * Every RSVP write goes through `recordAnswer`, which calls this, so a decline
 * from the guest's own form and one the host records by phone behave alike.
 */
export async function releaseSeat(tx: Prisma.TransactionClient, guestId: string): Promise<void> {
  const seat = await tx.seat.findUnique({ where: { guestId }, select: { tableId: true } });
  if (!seat) return;

  await tx.seat.delete({ where: { guestId } });
  await tx.guest.update({
    where: { id: guestId },
    data: { seatReleasedAt: new Date(), seatReleasedFromTableId: seat.tableId },
  });
}

/** What clears the flag: seating the guest again, or the host dismissing it. */
export const NOT_RELEASED = { seatReleasedAt: null, seatReleasedFromTableId: null } satisfies Prisma.GuestUncheckedUpdateManyInput;
