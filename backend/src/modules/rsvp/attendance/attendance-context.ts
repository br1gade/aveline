import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AttendanceMode, Prisma, RsvpStatus } from '@prisma/client';
import { GUEST_FACING_VENUES } from '../../design/guest-facing-venues';
import { AttendanceAnswerDto } from '../dto/attendance.dto';
import { SubmitRsvpDto } from '../dto/submit-rsvp.dto';
import { summarizeAttendance } from './attendance-summary';

export type AttendanceContext = Awaited<ReturnType<typeof lockAttendancePolicy>>;

/** Policy locks precede household, guest, RSVP and seating locks everywhere. */
export async function lockAttendancePolicy(tx: Prisma.TransactionClient, eventId: string, isExclusive = false) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM events WHERE id = ${eventId} ${Prisma.raw(isExclusive ? 'FOR UPDATE' : 'FOR SHARE')}`;
  if (rows.length === 0) throw new NotFoundException('No such event');
  return tx.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { id: true, attendanceMode: true, attendanceRevision: true, venues: { where: GUEST_FACING_VENUES, select: { id: true } } },
  });
}

export function assertAttendanceRevision(policy: AttendanceContext, revision?: number) {
  const canUseLegacy = policy.attendanceMode === AttendanceMode.EVENT_WIDE && policy.attendanceRevision === 1;
  if (revision === policy.attendanceRevision || (revision === undefined && canUseLegacy)) return;
  throw new ConflictException('attendanceRevision: attendance policy changed; reload the invitation and reconfirm');
}

export async function normalizeHouseholdAttendance(tx: Prisma.TransactionClient, policy: AttendanceContext, dto: SubmitRsvpDto, guestId: string) {
  assertAttendanceRevision(policy, dto.attendanceRevision);
  const earlier = await tx.attendanceResponse.findMany({
    where: { eventId: policy.id, revision: policy.attendanceRevision, guest: { household: { guests: { some: { id: guestId } } } } },
    select: { guestId: true, venueId: true, status: true },
  });
  const answersOf = (id: string) => earlier.filter((answer) => answer.guestId === id);
  return {
    ...normalizePersonAttendance(policy, dto, answersOf(guestId)),
    members: dto.members?.map((member) => normalizePersonAttendance(policy, member, answersOf(member.guestId))),
    party: dto.party?.map((member) => normalizePersonAttendance(policy, member, [], dto.status)),
  };
}

export function normalizePersonAttendance<T extends AttendanceAnswerDto>(policy: AttendanceContext, answer: T, earlier: { venueId: string | null; status: RsvpStatus }[], fallback?: RsvpStatus): T & { status: RsvpStatus } {
  if (policy.attendanceMode === AttendanceMode.EVENT_WIDE) {
    if (answer.venueAttendance) throw new BadRequestException('venueAttendance: this event takes one event-wide answer');
    const status = answer.status ?? fallback;
    if (!status) throw new BadRequestException('status: required for event-wide attendance');
    return { ...answer, status };
  }
  if (answer.status !== undefined) throw new BadRequestException('status: omit in per-venue mode; use venueAttendance');
  const venues = policy.venues.map((venue) => venue.id);
  assertVenueAnswers(venues, answer.venueAttendance);
  const merged = new Map(earlier.flatMap((old) => old.venueId ? [[old.venueId, old.status] as const] : []));
  for (const current of answer.venueAttendance ?? []) merged.set(current.venueId, current.status);
  return { ...answer, status: summarizeAttendance(venues, [...merged].map(([venueId, status]) => ({ venueId, status }))) };
}

function assertVenueAnswers(venues: string[], answers?: { venueId: string; status: RsvpStatus }[]) {
  if (!answers?.length) throw new BadRequestException('venueAttendance: give this person at least one venue answer');
  const seen = new Set<string>();
  for (const answer of answers) {
    if (!venues.includes(answer.venueId)) throw new BadRequestException('venueAttendance: venue is not guest-facing on this event');
    if (seen.has(answer.venueId)) throw new BadRequestException('venueAttendance: a venue is answered twice');
    seen.add(answer.venueId);
  }
}
