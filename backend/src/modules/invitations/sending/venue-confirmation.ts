import { Prisma } from '@prisma/client';

export const VENUE_CONFIRMATION_TEMPLATE_KEY = 'rsvp.confirmation.venues';

/** Answers at one venue must not produce a misleading event-wide confirmation. */
export async function venueConfirmationDedupe(prisma: Pick<Prisma.TransactionClient, '$queryRaw' | 'message'>, householdId: string, now: Date) {
  const minuteStart = new Date(now); minuteStart.setUTCSeconds(0, 0);
  const [snapshot] = await prisma.$queryRaw<{ fingerprint: string; latestKey: string | null; sequence: bigint }[]>`WITH snapshot AS (
    SELECT md5(concat(e."attendanceRevision", string_agg(concat(a."guestId", a."scopeId", a.status), '|' ORDER BY a."guestId", a."scopeId"))) AS fingerprint
    FROM events e JOIN guests g ON g."eventId" = e.id AND g."householdId" = ${householdId}
    LEFT JOIN attendance_responses a ON a."guestId" = g.id AND a.revision = e."attendanceRevision"
    GROUP BY e.id
  ), earlier AS MATERIALIZED (
    SELECT m.id, m."dedupeKey", m."createdAt" FROM messages m JOIN guests g ON g.id = m."guestId"
    WHERE g."householdId" = ${householdId} AND m."templateKey" = ${VENUE_CONFIRMATION_TEMPLATE_KEY} AND m."createdAt" >= ${minuteStart}
  ) SELECT snapshot.fingerprint,
    (SELECT "dedupeKey" FROM earlier ORDER BY "createdAt" DESC, id DESC LIMIT 1) AS "latestKey",
    (SELECT count(*) FROM earlier) AS sequence FROM snapshot`;
  if (!snapshot) return null;
  const minute = now.toISOString().slice(0, 16);
  const prefix = `rsvp-venues:${householdId}:${snapshot.fingerprint}:${minute}:`;
  if (snapshot.latestKey?.startsWith(prefix)) return null;
  return `${prefix}${snapshot.sequence}`;
}
