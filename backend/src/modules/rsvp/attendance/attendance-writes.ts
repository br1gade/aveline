import { Prisma, Rsvp, RsvpStatus } from '@prisma/client';
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
  const payload = JSON.stringify({ revision: policy.attendanceRevision, mode: policy.attendanceMode, answeredAt: new Date(), answers });
  const [rsvp] = await tx.$queryRaw<Rsvp[]>`SELECT * FROM save_guest_attendance(${policy.id}, ${guestId}, ${payload}::jsonb)`;
  if (!rsvp) throw new Error('Attendance write did not return its RSVP');
  if (policy.attendanceMode === 'EVENT_WIDE') {
    if (status === 'DECLINED') await releaseSeat(tx, guestId);
    return rsvp;
  }
  const declined = answers.filter((answer) => answer.status === 'DECLINED').map((answer) => answer.venueId!);
  if (declined.length) await releaseSeat(tx, guestId, declined);
  return rsvp;
}

/** Called inside the same policy-locked transaction as a venue/timeline edit. */
export async function refreshVenueAttendance(tx: Prisma.TransactionClient, eventId: string) {
  await tx.$executeRaw`SELECT refresh_venue_attendance(${eventId})`;
}
