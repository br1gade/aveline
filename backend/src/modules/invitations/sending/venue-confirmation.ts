import { Prisma } from '@prisma/client';

export const VENUE_CONFIRMATION_TEMPLATE_KEY = 'rsvp.confirmation.venues';

/** Answers at one venue must not produce a misleading event-wide confirmation. */
export async function venueConfirmationDedupe(prisma: Pick<Prisma.TransactionClient, '$queryRaw' | 'message'>, householdId: string, now: Date) {
  const [snapshot] = await prisma.$queryRaw<{ fingerprint: string }[]>`
    SELECT md5(concat(e."attendanceRevision", string_agg(concat(a."guestId", a."scopeId", a.status), '|' ORDER BY a."guestId", a."scopeId"))) AS fingerprint
    FROM events e JOIN guests g ON g."eventId" = e.id AND g."householdId" = ${householdId}
    LEFT JOIN attendance_responses a ON a."guestId" = g.id AND a.revision = e."attendanceRevision"
    GROUP BY e.id`;
  const minute = now.toISOString().slice(0, 16);
  const minuteStart = new Date(now);
  minuteStart.setUTCSeconds(0, 0);
  const earlier = await prisma.message.findMany({
    where: { guest: { householdId }, templateKey: VENUE_CONFIRMATION_TEMPLATE_KEY, createdAt: { gte: minuteStart } },
    orderBy: { createdAt: 'desc' }, select: { dedupeKey: true },
  });
  const prefix = `rsvp-venues:${householdId}:${snapshot.fingerprint}:${minute}:`;
  if (earlier[0]?.dedupeKey?.startsWith(prefix)) return null;
  return `${prefix}${earlier.length}`;
}
