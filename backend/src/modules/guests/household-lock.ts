import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * A household's seats and how many of them are named, read under a row lock.
 *
 * Capacity is a read-then-write rule — count the named guests, then add one —
 * and two writers counting at once would both see room for the last seat. A
 * host adding a guest while that household's own guest submits a plus-one is
 * exactly that. Locking the household row serialises every writer that
 * changes who is in it, so the count each one reads is still true when it
 * writes. Held until the surrounding transaction ends.
 *
 * Several households are locked in id order, so two moves in opposite
 * directions cannot deadlock.
 */
export interface LockedHousehold {
  id: string;
  seatsAllotted: number;
  namedGuests: number;
}

export async function lockHouseholds(
  tx: Prisma.TransactionClient,
  eventId: string,
  householdIds: string[],
): Promise<Map<string, LockedHousehold>> {
  const ids = [...new Set(householdIds)].sort();
  const locked = new Map<string, LockedHousehold>();

  for (const id of ids) {
    const rows = await tx.$queryRaw<{ id: string; seatsAllotted: number }[]>`
      SELECT id, "seatsAllotted" FROM households
      WHERE id = ${id} AND "eventId" = ${eventId}
      FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException(`No household ${id} on this event`);

    const namedGuests = await tx.guest.count({ where: { householdId: id } });
    locked.set(id, { id, seatsAllotted: rows[0].seatsAllotted, namedGuests });
  }

  return locked;
}

export async function lockHousehold(
  tx: Prisma.TransactionClient,
  eventId: string,
  householdId: string,
): Promise<LockedHousehold> {
  const [household] = (await lockHouseholds(tx, eventId, [householdId])).values();
  return household;
}
