import { Prisma, RsvpStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { GUEST_FACING_VENUES } from '../design/guest-facing-venues';

export interface VenueHeadcount {
  venueId: string;
  venue: string;
  invited: number;
  attending: number;
  declined: number;
  undecided: number;
  pending: number;
}

export function venueHeadcount(prisma: Pick<Prisma.TransactionClient, '$queryRaw'>, eventId: string) {
  return prisma.$queryRaw<VenueHeadcount[]>`
    SELECT v.id AS "venueId", v.name AS venue, count(g.id)::int AS invited,
      count(g.id) FILTER (WHERE (CASE WHEN e."attendanceMode" = 'EVENT_WIDE' THEN r.status ELSE a.status END) = 'ATTENDING')::int AS attending,
      count(g.id) FILTER (WHERE (CASE WHEN e."attendanceMode" = 'EVENT_WIDE' THEN r.status ELSE a.status END) = 'DECLINED')::int AS declined,
      count(g.id) FILTER (WHERE (CASE WHEN e."attendanceMode" = 'EVENT_WIDE' THEN r.status ELSE a.status END) = 'UNDECIDED')::int AS undecided,
      count(g.id) FILTER (WHERE COALESCE((CASE WHEN e."attendanceMode" = 'EVENT_WIDE' THEN r.status ELSE a.status END), 'PENDING') = 'PENDING')::int AS pending
    FROM venues v JOIN events e ON e.id = v."eventId"
    LEFT JOIN guests g ON g."eventId" = e.id LEFT JOIN rsvps r ON r."guestId" = g.id
    LEFT JOIN attendance_responses a ON a."guestId" = g.id AND a.revision = e."attendanceRevision" AND a."venueId" = v.id
    WHERE e.id = ${eventId} AND v.role <> 'PREPARATION'
      AND (NOT EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND t."isInternal")
        OR EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND NOT t."isInternal"))
    GROUP BY v.id ORDER BY v."sortOrder", v.id`;
}

export async function attendingAtVenue(prisma: Pick<Prisma.TransactionClient, 'event' | 'venue'>, eventId: string, venueId?: string): Promise<Prisma.GuestWhereInput> {
  if (!venueId) return { eventId, rsvp: { status: RsvpStatus.ATTENDING } };
  const venue = await prisma.venue.findFirst({ where: { id: venueId, eventId, ...GUEST_FACING_VENUES }, select: { id: true } });
  if (!venue) throw new NotFoundException('venueId: no guest-facing venue on this event');
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { attendanceMode: true, attendanceRevision: true } });
  if (event.attendanceMode === 'EVENT_WIDE') return { eventId, rsvp: { status: RsvpStatus.ATTENDING } };
  return { eventId, attendanceResponses: { some: { revision: event.attendanceRevision, venueId, status: RsvpStatus.ATTENDING } } };
}
