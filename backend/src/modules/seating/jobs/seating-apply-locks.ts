import { Prisma } from '@prisma/client';
import { assertSeatingBounds } from './seating-input';
import { SeatingJobError } from './seating-queue';

/** Busy writers are retried rather than waiting with a partially locked household. */
export async function lockSeatingInputs(tx: Prisma.TransactionClient, eventId: string, arrangementId: string): Promise<void> {
  await assertSeatingBounds(tx, eventId, arrangementId);
  const guests = await tx.guest.count({ where: { eventId } });
  const lockedGuests = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM guests WHERE "eventId" = ${eventId} ORDER BY id FOR SHARE SKIP LOCKED`;
  if (guests !== lockedGuests.length) throw new SeatingJobError('STATE_CHANGED');
  const answers = await tx.rsvp.count({ where: { guest: { eventId } } });
  const lockedAnswers = await tx.$queryRaw<{ id: string }[]>`SELECT r.id FROM rsvps r JOIN guests g ON g.id = r."guestId"
    WHERE g."eventId" = ${eventId} ORDER BY r.id FOR SHARE OF r SKIP LOCKED`;
  if (answers !== lockedAnswers.length) throw new SeatingJobError('STATE_CHANGED');
  const tables = await tx.table.count({ where: { arrangementId } });
  const lockedTables = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tables WHERE "arrangementId" = ${arrangementId} ORDER BY id FOR SHARE SKIP LOCKED`;
  if (tables !== lockedTables.length) throw new SeatingJobError('STATE_CHANGED');
}
