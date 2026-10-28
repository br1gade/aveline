import { AttendanceMode, Prisma, RsvpStatus } from '@prisma/client';
import { translatedField } from '../../../common/field-translations';
import { GUEST_FACING_VENUES } from '../../design/guest-facing-venues';

export const ACTIVE_ATTENDANCE = {
  where: { policy: { isActive: true } },
  select: { venueId: true, status: true, respondedAt: true },
} satisfies Prisma.Guest$attendanceResponsesArgs;

export const ATTENDANCE_GUEST = {
  event: { select: {
    attendanceMode: true, attendanceRevision: true,
    venues: { where: GUEST_FACING_VENUES, select: { id: true, name: true, translations: true }, orderBy: { sortOrder: 'asc' } },
  } },
  attendanceResponses: ACTIVE_ATTENDANCE,
  rsvp: { select: { status: true } },
} satisfies Prisma.GuestInclude;

type AttendanceGuest = Pick<Prisma.GuestGetPayload<{ include: typeof ATTENDANCE_GUEST }>, 'event' | 'rsvp' | 'attendanceResponses'>;

export function attendanceView(guest: AttendanceGuest, locale?: string) {
  const { attendanceMode: mode, attendanceRevision: revision, venues } = guest.event;
  const answers = guest.attendanceResponses;
  const currentVenues = mode === AttendanceMode.PER_VENUE ? venues.map((venue) => {
    const answer = answers.find((response) => response.venueId === venue.id);
    return {
      venueId: venue.id, venue: locale ? translatedField(venue.translations, locale, 'name') ?? venue.name : venue.name,
      status: answer?.status ?? RsvpStatus.PENDING, respondedAt: answer?.respondedAt ?? null,
    };
  }) : [];
  const hasPending = mode === AttendanceMode.PER_VENUE
    ? currentVenues.some((venue) => venue.status === RsvpStatus.PENDING)
    : !guest.rsvp || guest.rsvp.status === RsvpStatus.PENDING;
  return {
    mode, revision, status: guest.rsvp?.status ?? RsvpStatus.PENDING,
    needsReconfirmation: revision > 1 && hasPending, venues: currentVenues,
  };
}

export function isAttendanceReservation(guest: AttendanceGuest, venueId: string | null) {
  if (guest.event.attendanceMode === AttendanceMode.EVENT_WIDE) return guest.rsvp?.status !== RsvpStatus.ATTENDING;
  if (!guest.event.venues.some((venue) => venue.id === venueId)) return true;
  return !venueId || !guest.attendanceResponses.some((answer) => answer.venueId === venueId && answer.status === RsvpStatus.ATTENDING);
}
