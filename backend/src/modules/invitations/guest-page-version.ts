import { EventVisibility, InvitationStatus, Prisma } from '@prisma/client';
import { compactGuestPayloadChanges } from './guest-payload-version';

export interface GuestPageMeta {
  eventId: string; locales: string[]; defaultLocale: string; visibility: EventVisibility;
  status: InvitationStatus; expiresAt: Date | null; guestId: string | null; guestLocale: string | null; revision: bigint;
  sharedRevision?: bigint; personalRevision?: bigint; guestHouseholdId?: string | null;
}
/** A live capability/availability check and durable committed revision in one snapshot. */
export async function readGuestPageMeta(tx: Prisma.TransactionClient, slug: string, token?: string) {
  const rows = await readGuestPageBatch(tx, slug, [token]);
  return rows.map(({ requestIndex: _requestIndex, ...meta }) => meta);
}

/** Aggregate counters once per event/snapshot, not in one SQL function per guest. */
export function readGuestPageBatch(tx: Prisma.TransactionClient, slug: string, tokens: (string | undefined)[], shouldIncludeLegacyRevision = true) {
  if (!tokens.length || tokens.length > 100) throw new Error('Capability batch exceeds its bound');
  const requested = Prisma.join(tokens.map((token, index) => Prisma.sql`(${index}::int, ${token ?? null}::text)`));
  const legacyRevision = shouldIncludeLegacyRevision
    ? Prisma.sql`COALESCE(v.revision, 0) + (SELECT count(*) FROM guest_page_changes c WHERE c."eventId" = e.id)` : Prisma.sql`0::bigint`;
  const legacyJoin = shouldIncludeLegacyRevision ? Prisma.sql`LEFT JOIN guest_page_versions v ON v."eventId" = e.id` : Prisma.empty;
  return tx.$queryRaw<(GuestPageMeta & { requestIndex: number })[]>`WITH requested("requestIndex", token) AS (VALUES ${requested}),
    event_scope AS MATERIALIZED (
      SELECT e.id AS "eventId", e.locales, e."defaultLocale", e.visibility, i.status, i."expiresAt",
        ${legacyRevision} AS revision
      FROM invitations i JOIN events e ON e.id = i."eventId" ${legacyJoin} WHERE i.slug = ${slug}
    ), payload_totals AS MATERIALIZED (
      SELECT scope, sum(version)::bigint AS revision FROM (
        SELECT v.scope, v.revision AS version FROM guest_payload_versions v JOIN event_scope e ON e."eventId" = v."eventId"
        UNION ALL
        SELECT c.scope, count(*) AS version FROM guest_payload_changes c JOIN event_scope e ON e."eventId" = c."eventId" GROUP BY c.scope
      ) counts GROUP BY scope
    ) SELECT e.*, requested."requestIndex", g.id AS "guestId", g.locale AS "guestLocale", g."householdId" AS "guestHouseholdId",
      COALESCE(shared.revision, 0) AS "sharedRevision", COALESCE(personal.revision, 0) AS "personalRevision"
    FROM event_scope e CROSS JOIN requested
    LEFT JOIN guests g ON g."eventId" = e."eventId" AND g.token = requested.token AND g."anonymizedAt" IS NULL
    LEFT JOIN payload_totals shared ON shared.scope = 'shared'
    LEFT JOIN payload_totals personal ON personal.scope = 'household:' || g."householdId"`;
}

/** Count committed changes, not the largest transaction id: older transactions may commit last. */
export async function compactGuestPageChanges(tx: Prisma.TransactionClient) {
  const changed = await tx.$queryRaw<{ eventId: string }[]>`WITH scopes AS (
      SELECT v."eventId" FROM guest_page_versions v WHERE EXISTS (SELECT 1 FROM guest_page_changes c WHERE c."eventId" = v."eventId")
      ORDER BY v."eventId" FOR UPDATE SKIP LOCKED LIMIT 50
    ), batch AS (
      SELECT c."eventId", c."transactionId" FROM guest_page_changes c JOIN scopes s ON s."eventId" = c."eventId"
      ORDER BY c."eventId", c."transactionId" LIMIT 1000
    ), removed AS (
      DELETE FROM guest_page_changes c USING batch b WHERE c."eventId" = b."eventId" AND c."transactionId" = b."transactionId" RETURNING c."eventId"
    ), totals AS (SELECT "eventId", count(*) AS count FROM removed GROUP BY "eventId")
    UPDATE guest_page_versions v SET revision = v.revision + totals.count FROM totals
      WHERE v."eventId" = totals."eventId" RETURNING v."eventId"`;
  // No parent FK on the append ledger: writers must not take event locks after
  // household/seating locks. Remove rare concurrent-deletion metadata here.
  const orphans = await tx.$executeRaw`WITH batch AS (
      SELECT c."eventId", c."transactionId" FROM guest_page_changes c WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = c."eventId")
      ORDER BY c."eventId", c."transactionId" FOR UPDATE SKIP LOCKED LIMIT 1000)
    DELETE FROM guest_page_changes c USING batch b WHERE c."eventId" = b."eventId" AND c."transactionId" = b."transactionId"`;
  return { scopesCompacted: changed.length, orphanChangesRemoved: orphans, ...await compactGuestPayloadChanges(tx) };
}
