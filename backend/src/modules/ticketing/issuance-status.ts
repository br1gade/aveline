import { summarizeAttendance } from '../rsvp/attendance/attendance-summary';
import { VenueAttendanceDto } from '../rsvp/dto/attendance.dto';
import { OrderAttendee, RsvpStatus } from '@prisma/client';
import { AttendanceContext } from '../rsvp/attendance/attendance-context';

type Policy = Pick<AttendanceContext, 'attendanceMode' | 'attendanceRevision' | 'venues'>;
type Attendee = Pick<OrderAttendee, 'attendanceRevision' | 'status' | 'venueAttendance'>;

export function issuanceStatus(policy: Policy, attendee: Attendee): RsvpStatus {
  if (attendee.attendanceRevision !== policy.attendanceRevision) return RsvpStatus.PENDING;
  if (policy.attendanceMode === 'EVENT_WIDE') return attendee.status;
  return summarizeAttendance(policy.venues.map((venue) => venue.id), attendee.venueAttendance as unknown as VenueAttendanceDto[]);
}
