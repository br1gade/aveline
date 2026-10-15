import { Prisma, RsvpStatus } from '@prisma/client';
import { AttendanceContext } from './attendance-context';
import { VenueAttendanceDto } from '../dto/attendance.dto';
import { releaseSeat } from '../../seating/released-seat';

export interface AttendanceWrite {
  policy: AttendanceContext;
  venueAttendance?: VenueAttendanceDto[];
}

export async function writeAttendance(tx: Prisma.TransactionClient, guestId: string, status: RsvpStatus, attendance: AttendanceWrite) {
  const { policy } = attendance;
  const answers = policy.attendanceMode === 'EVENT_WIDE'
    ? [{ scopeId: 'event', venueId: null, status }]
    : (attendance.venueAttendance ?? []).map((answer) => ({ ...answer, scopeId: answer.venueId }));
  const now = new Date();
  // DTO bounds the venue set to 100; one bulk upsert also keeps the lock order stable.
  if (answers.length > 0) await tx.$executeRaw`
    INSERT INTO attendance_responses (id, "eventId", "guestId", revision, "scopeId", "venueId", status, "respondedAt", "updatedAt")
    VALUES ${Prisma.join(answers.map((answer) => Prisma.sql`(
      ${`${guestId}:${policy.attendanceRevision}:${answer.scopeId}`}, ${policy.id}, ${guestId}, ${policy.attendanceRevision},
      ${answer.scopeId}, ${answer.venueId}, ${answer.status}::"RsvpStatus", ${now}, ${now})`))}
    ON CONFLICT ("guestId", revision, "scopeId") DO UPDATE SET status = EXCLUDED.status, "updatedAt" = EXCLUDED."updatedAt"`;
  if (policy.attendanceMode === 'EVENT_WIDE') {
    if (status === 'DECLINED') await releaseSeat(tx, guestId);
    return;
  }
  const declined = answers.filter((answer) => answer.status === 'DECLINED').map((answer) => answer.venueId!);
  if (declined.length) await releaseSeat(tx, guestId, declined);
  await tx.$executeRaw`SELECT refresh_venue_attendance(${policy.id}, ${guestId})`;
}

/** Called inside the same policy-locked transaction as a venue/timeline edit. */
export async function refreshVenueAttendance(tx: Prisma.TransactionClient, eventId: string) {
  await tx.$executeRaw`SELECT refresh_venue_attendance(${eventId})`;
}
