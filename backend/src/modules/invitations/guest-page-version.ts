import { EventVisibility, InvitationStatus, Prisma } from '@prisma/client';

export interface GuestPageMeta {
  eventId: string; locales: string[]; defaultLocale: string; visibility: EventVisibility;
  status: InvitationStatus; expiresAt: Date | null; guestId: string | null; guestLocale: string | null; revision: bigint;
}
/** A live capability/availability check and durable committed revision in one snapshot. */
export function readGuestPageMeta(tx: Prisma.TransactionClient, slug: string, token?: string) {
  return tx.$queryRaw<GuestPageMeta[]>`SELECT e.id AS "eventId", e.locales, e."defaultLocale", e.visibility,
    i.status, i."expiresAt", g.id AS "guestId", g.locale AS "guestLocale",
    COALESCE(v.revision, 0) + (SELECT count(*) FROM guest_page_changes c WHERE c."eventId" = e.id) AS revision
    FROM invitations i JOIN events e ON e.id = i."eventId"
    LEFT JOIN guest_page_versions v ON v."eventId" = e.id
    LEFT JOIN guests g ON g."eventId" = e.id AND g.token = ${token ?? null}::text AND g."anonymizedAt" IS NULL
    WHERE i.slug = ${slug}`;
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
  return { scopesCompacted: changed.length, orphanChangesRemoved: orphans };
}
