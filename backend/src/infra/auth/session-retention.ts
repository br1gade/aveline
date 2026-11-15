import { PrismaService } from '../../prisma/prisma.service';

/** Decided 14 November 2026: where and how an account signed in is kept 30 days after the session ends. */
export const SESSION_RETENTION_DAYS = 30;

/** Rows per statement, so a first run over a large table holds no long lock. */
const BATCH = 5_000;

/**
 * Deletes sessions 30 days past their expiry, and clears the address and
 * browser of a session revoked more than 30 days ago.
 *
 * A revoked session's row is not deleted before its token expires: a
 * replaced refresh token used again is how theft is noticed
 * (`AuthService.refresh`), and without the row it would read as unknown.
 */
export async function pruneSessions(prisma: PrismaService, now: Date): Promise<{ deleted: number; forgotten: number }> {
  const cutoff = new Date(now.getTime() - SESSION_RETENTION_DAYS * 86_400_000);
  const deleted = await inBatches(() => prisma.$executeRaw`
    DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE "expiresAt" < ${cutoff} LIMIT ${BATCH})`);
  const forgotten = await inBatches(() => prisma.$executeRaw`
    UPDATE sessions SET "ipAddress" = NULL, "userAgent" = NULL
    WHERE id IN (SELECT id FROM sessions WHERE "revokedAt" < ${cutoff}
      AND ("ipAddress" IS NOT NULL OR "userAgent" IS NOT NULL) LIMIT ${BATCH})`);
  return { deleted, forgotten };
}

async function inBatches(statement: () => Promise<number>): Promise<number> {
  let total = 0;
  let count: number;
  do {
    count = await statement();
    total += count;
  } while (count === BATCH);
  return total;
}
