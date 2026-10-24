import { Prisma } from '@prisma/client';

/** Delete committed ledger rows and advance bases in the same snapshot boundary. */
export async function compactGuestPayloadChanges(tx: Prisma.TransactionClient) {
  const changed = await tx.$queryRaw<{ eventId: string }[]>`WITH batch AS (
      SELECT "eventId", scope, "transactionId" FROM guest_payload_changes
      ORDER BY "eventId", scope, "transactionId" FOR UPDATE SKIP LOCKED LIMIT 1000
    ), removed AS (
      DELETE FROM guest_payload_changes c USING batch b
      WHERE (c."eventId", c.scope, c."transactionId") = (b."eventId", b.scope, b."transactionId")
      RETURNING c."eventId", c.scope
    ), totals AS (
      SELECT r."eventId", r.scope, count(*) AS count FROM removed r
      WHERE EXISTS (SELECT 1 FROM events e WHERE e.id = r."eventId") GROUP BY r."eventId", r.scope
    ) INSERT INTO guest_payload_versions ("eventId", scope, revision)
      SELECT "eventId", scope, count FROM totals ORDER BY "eventId", scope
      ON CONFLICT ("eventId", scope) DO UPDATE SET revision = guest_payload_versions.revision + EXCLUDED.revision
      RETURNING "eventId"`;
  const orphans = await tx.$executeRaw`WITH batch AS (
      SELECT v."eventId", v.scope FROM guest_payload_versions v WHERE
        NOT EXISTS (SELECT 1 FROM events e WHERE e.id = v."eventId") OR
        (v.scope LIKE 'household:%' AND NOT EXISTS (SELECT 1 FROM households h WHERE h.id = substring(v.scope FROM 11) AND h."eventId" = v."eventId"))
      ORDER BY v."eventId", v.scope FOR UPDATE SKIP LOCKED LIMIT 1000
    ) DELETE FROM guest_payload_versions v USING batch b WHERE (v."eventId", v.scope) = (b."eventId", b.scope)`;
  return { payloadScopesCompacted: changed.length, orphanPayloadScopesRemoved: orphans };
}
