import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceMode, Prisma } from '@prisma/client';
import { CacheService } from '../../infra/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GUEST_FACING_VENUES } from '../design/guest-facing-venues';
import { attendanceImpact, snapshotEventAttendance } from './attendance-impact';
import { ChangeAttendancePolicyDto } from './dto/attendance-policy.dto';

@Injectable()
export class AttendancePolicyService {
  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService) {}

  async preview(eventId: string, mode: AttendanceMode) {
    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      await assertModeChange(tx, event, mode);
      const { previewToken, ...affected } = await attendanceImpact(tx, eventId, mode);
      const request = { mode, expectedRevision: event.attendanceRevision, previewToken };
      return { ...request, affected, request, seatsRetainedAsReservations: true };
    });
  }

  async change(eventId: string, dto: ChangeAttendancePolicyDto) {
    const policy = await this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      const previous = await tx.attendancePolicy.findUnique({ where: { eventId_transitionId: { eventId, transitionId: dto.transitionId } } });
      if (previous) return assertSameRetry(previous, dto);
      if (event.attendanceRevision !== dto.expectedRevision) throw new ConflictException('expectedRevision: attendance policy changed; preview again');
      await assertModeChange(tx, event, dto.mode);
      const impact = await attendanceImpact(tx, eventId, dto.mode);
      if (impact.previewToken !== dto.previewToken) throw new ConflictException('previewToken: attendance or seating changed; preview again');
      await snapshotEventAttendance(tx, eventId);
      await tx.attendancePolicy.updateMany({ where: { eventId, isActive: true }, data: { isActive: false } });
      const created = await tx.attendancePolicy.create({ data: {
        eventId, revision: event.attendanceRevision + 1, mode: dto.mode, transitionId: dto.transitionId, previewToken: dto.previewToken,
      } });
      await tx.event.update({ where: { id: eventId }, data: { attendanceMode: dto.mode, attendanceRevision: created.revision } });
      await tx.rsvp.updateMany({ where: { guest: { eventId } }, data: { status: 'PENDING', respondedAt: null } });
      return created;
    });
    const invitation = await this.prisma.invitation.findUnique({ where: { eventId }, select: { slug: true } });
    if (invitation) await this.cache.invalidateInvitation(invitation.slug);
    return {
      mode: policy.mode, revision: policy.revision,
      notice: { requiresReconfirmation: true, notificationPath: invitation ? `/api/v1/invitations/${invitation.slug}/notify-changes` : null },
    };
  }

  async history(eventId: string, guestId: string) {
    const guest = await this.prisma.guest.findFirst({ where: { id: guestId, eventId }, select: { id: true } });
    if (!guest) throw new NotFoundException('No such guest on this event');
    return this.prisma.attendanceResponse.findMany({
      where: { guestId, eventId }, orderBy: [{ revision: 'desc' }, { scopeId: 'asc' }], take: 1000,
      select: { revision: true, status: true, respondedAt: true, updatedAt: true, venueId: true,
        venue: { select: { name: true } }, policy: { select: { mode: true, isActive: true } } },
    });
  }
}

async function lockEvent(tx: Prisma.TransactionClient, eventId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
  if (!rows.length) throw new NotFoundException('No such event');
  return tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { id: true, attendanceMode: true, attendanceRevision: true } });
}

async function assertModeChange(tx: Prisma.TransactionClient, event: { id: string; attendanceMode: AttendanceMode }, mode: AttendanceMode) {
  if (event.attendanceMode === mode) throw new BadRequestException('mode: already using this attendance mode');
  if (mode === 'PER_VENUE' && await tx.venue.count({ where: { eventId: event.id, ...GUEST_FACING_VENUES } }) === 0) {
    throw new BadRequestException('mode: per-venue attendance needs a guest-facing venue');
  }
}

function assertSameRetry(policy: { revision: number; mode: AttendanceMode; previewToken: string | null }, dto: ChangeAttendancePolicyDto) {
  if (policy.revision !== dto.expectedRevision + 1 || policy.mode !== dto.mode || policy.previewToken !== dto.previewToken) {
    throw new ConflictException('transitionId: already used for another policy change');
  }
  return policy;
}
