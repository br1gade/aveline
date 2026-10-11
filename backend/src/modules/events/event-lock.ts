import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';

/**
 * Locks an event's row for the rest of the transaction and refuses an
 * archived one.
 *
 * Archiving closes the invitation and takes the listing down in one
 * transaction; publishing checked "not archived" before its own and could
 * land just after, leaving an archived event live (B87). Both take this lock,
 * so one waits for the other and then sees what it did.
 */
export async function lockLiveEvent(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ status: EventStatus }[]>`
    SELECT status FROM events WHERE id = ${eventId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException(`No event ${eventId}`);
  if (rows[0].status === EventStatus.ARCHIVED) {
    throw new BadRequestException('This event is archived; bring it back with POST /events/:id/unarchive first');
  }
}
