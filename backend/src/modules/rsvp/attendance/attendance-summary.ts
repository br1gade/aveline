import { RsvpStatus } from '@prisma/client';

export function summarizeAttendance(venues: string[], answers: { venueId: string; status: RsvpStatus }[]): RsvpStatus {
  const byVenue = new Map(answers.map((answer) => [answer.venueId, answer.status]));
  const statuses = venues.map((id) => byVenue.get(id) ?? RsvpStatus.PENDING);
  if (statuses.includes(RsvpStatus.ATTENDING)) return RsvpStatus.ATTENDING;
  if (statuses.length === 0 || statuses.includes(RsvpStatus.PENDING)) return RsvpStatus.PENDING;
  if (statuses.includes(RsvpStatus.UNDECIDED)) return RsvpStatus.UNDECIDED;
  return RsvpStatus.DECLINED;
}
