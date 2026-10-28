import { AttendanceMode, Prisma } from '@prisma/client';

interface AttendanceImpact {
  previewToken: string;
  guests: number;
  responses: number;
  seatedGuests: number;
  seats: number;
}

/** One statement observes a consistent snapshot, including changes that preserve headcounts. */
export async function attendanceImpact(tx: Prisma.TransactionClient, eventId: string, mode: AttendanceMode) {
  const [impact] = await tx.$queryRaw<AttendanceImpact[]>`
    SELECT md5(concat(${eventId}, ${mode}::text, e."attendanceRevision",
      (SELECT string_agg(concat(g.id, r.status, r."updatedAt"), '|' ORDER BY g.id)
       FROM guests g LEFT JOIN rsvps r ON r."guestId" = g.id WHERE g."eventId" = e.id),
      (SELECT string_agg(concat(s.id, s."tableId", s.position), '|' ORDER BY s.id) FROM seats s WHERE s."eventId" = e.id),
      (SELECT string_agg(concat(v.id, v.role, v.name), '|' ORDER BY v.id) FROM venues v WHERE v."eventId" = e.id),
      (SELECT string_agg(concat(t.id, t."venueId", t."isInternal"), '|' ORDER BY t.id) FROM timeline_entries t WHERE t."eventId" = e.id)
    )) AS "previewToken",
    (SELECT count(*)::int FROM guests g WHERE g."eventId" = e.id) AS guests,
    (SELECT count(*)::int FROM rsvps r JOIN guests g ON g.id = r."guestId" WHERE g."eventId" = e.id AND r."respondedAt" IS NOT NULL) AS responses,
    (SELECT count(DISTINCT s."guestId")::int FROM seats s WHERE s."eventId" = e.id) AS "seatedGuests",
    (SELECT count(*)::int FROM seats s WHERE s."eventId" = e.id) AS seats
    FROM events e WHERE e.id = ${eventId}`;
  return impact;
}

export async function snapshotEventAttendance(tx: Prisma.TransactionClient, eventId: string) {
  await tx.$executeRaw`
    INSERT INTO attendance_responses (id, "eventId", "guestId", revision, "scopeId", status, "respondedAt", "updatedAt")
    SELECT concat(g.id, ':', e."attendanceRevision", ':event'), e.id, g.id, e."attendanceRevision", 'event',
      r.status, r."respondedAt", r."updatedAt"
    FROM guests g JOIN events e ON e.id = g."eventId" JOIN rsvps r ON r."guestId" = g.id
    WHERE e.id = ${eventId} AND e."attendanceMode" = 'EVENT_WIDE' AND r.status <> 'PENDING'
    ON CONFLICT ("guestId", revision, "scopeId") DO UPDATE SET status = EXCLUDED.status, "updatedAt" = EXCLUDED."updatedAt"`;
}
