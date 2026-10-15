import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockAttendancePolicy } from '../rsvp/attendance/attendance-context';

export async function beginCancellation(tx: Prisma.TransactionClient, eventId: string, orderId: string) {
  await lockAttendancePolicy(tx, eventId);
  await tx.$queryRaw`SELECT id FROM ticket_orders WHERE id = ${orderId} AND "eventId" = ${eventId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM guests WHERE id IN (SELECT "guestId" FROM tickets WHERE "orderId" = ${orderId}) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM tickets WHERE "orderId" = ${orderId} ORDER BY id FOR UPDATE`;
  const admitted = await tx.ticket.count({ where: { orderId, OR: [{ status: 'USED' }, { guest: { checkIn: { isNot: null } } }] } });
  if (admitted) throw new ConflictException(`${admitted} ticket(s) were already admitted; undo a mistaken admission first`);
  await tx.ticketOrder.updateMany({ where: { id: orderId, status: 'PAID', cancellationStartedAt: null }, data: { cancellationStartedAt: new Date() } });
}

/** The cancelled ticket cannot re-enter confirmed totals through a later RSVP. */
export async function withdrawTicketGuests(tx: Prisma.TransactionClient, eventId: string, orderId: string) {
  const guests = Prisma.sql`SELECT "guestId" FROM tickets WHERE "orderId" = ${orderId} AND "guestId" IS NOT NULL`;
  await tx.$executeRaw`INSERT INTO seat_releases (id, "guestId", "eventId", "arrangementId", "tableId", "releasedAt")
    SELECT concat(s."guestId", ':', s."arrangementId"), s."guestId", s."eventId", s."arrangementId", s."tableId", CURRENT_TIMESTAMP
    FROM seats s WHERE s."guestId" IN (${guests})
    ON CONFLICT ("guestId", "arrangementId") DO UPDATE SET "tableId" = EXCLUDED."tableId", "releasedAt" = EXCLUDED."releasedAt"`;
  await tx.$executeRaw`DELETE FROM seats WHERE "guestId" IN (${guests})`;
  await tx.$executeRaw`UPDATE rsvps SET status = 'DECLINED', "respondedAt" = COALESCE("respondedAt", CURRENT_TIMESTAMP), "updatedAt" = CURRENT_TIMESTAMP
    WHERE "guestId" IN (${guests})`;
  await tx.$executeRaw`INSERT INTO attendance_responses (id, "eventId", "guestId", revision, "scopeId", "venueId", status, "respondedAt", "updatedAt")
    SELECT concat(g.id, ':', e."attendanceRevision", ':', scope.id), e.id, g.id, e."attendanceRevision", scope.id, scope."venueId",
      'DECLINED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM guests g JOIN events e ON e.id = g."eventId"
    CROSS JOIN LATERAL (
      SELECT 'event' AS id, NULL::text AS "venueId" WHERE e."attendanceMode" = 'EVENT_WIDE'
      UNION ALL SELECT v.id, v.id FROM venues v WHERE v."eventId" = e.id AND e."attendanceMode" = 'PER_VENUE' AND v.role <> 'PREPARATION'
        AND (NOT EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND t."isInternal")
          OR EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND NOT t."isInternal"))
    ) scope WHERE e.id = ${eventId} AND g.id IN (${guests})
    ON CONFLICT ("guestId", revision, "scopeId") DO UPDATE SET status = 'DECLINED', "updatedAt" = CURRENT_TIMESTAMP`;
}
