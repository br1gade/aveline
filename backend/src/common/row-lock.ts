import { Prisma } from '@prisma/client';

/** Tables whose rows are edited by merging into what is there. */
type MergedTable = 'events' | 'venues' | 'invitations' | 'invitation_blocks' | 'rsvp_questions' | 'media_assets' | 'venue_profiles';

/**
 * Locks one row for the rest of the transaction, before it is read.
 *
 * Every edit that merges into stored JSON — one language of a translation,
 * one field of a settings object — reads the row, merges, and writes it all
 * back. Two co-hosts doing that at once each wrote back the other's stale
 * copy, and one edit vanished (B87). Read under this lock, the second waits
 * and merges into what the first wrote.
 */
export async function lockRow(tx: Prisma.TransactionClient, table: MergedTable, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id} FOR UPDATE`;
}
