import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SeatingJob } from '@prisma/client';
import { CreateSeatingJobDto } from '../dto/seating-job.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveArrangement } from '../seating-arrangements';
import { lockSeatingEvent, requireSeatingAccess } from './seating-access';

@Injectable()
export class SeatingJobsService {
  constructor(private readonly prisma: PrismaService) {}
  async create(eventId: string, userId: string, dto: CreateSeatingJobDto, arrangementId?: string) {
    const job = await this.prisma.$transaction(async (tx) => {
      await lockSeatingEvent(tx, eventId);
      await requireSeatingAccess(tx, eventId, userId);
      const previous = await tx.seatingJob.findUnique({ where: { eventId_requestedByUserId_idempotencyKey: { eventId, requestedByUserId: userId, idempotencyKey: dto.idempotencyKey } } });
      if (previous) {
        if (arrangementId && previous.arrangementId !== arrangementId) throw new ConflictException('idempotencyKey: already used for another arrangement');
        return previous;
      }
      const arrangement = await resolveArrangement(tx, eventId, arrangementId);
      if (await tx.seatingJob.findFirst({ where: { arrangementId: arrangement.id, status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } })) {
        throw new ConflictException('This arrangement already has an active seating job');
      }
      return tx.seatingJob.create({ data: { eventId, requestedByUserId: userId, arrangementId: arrangement.id, idempotencyKey: dto.idempotencyKey } });
    });
    return seatingJobView(job);
  }
  async list(eventId: string) {
    return this.prisma.seatingJob.findMany({ where: { eventId }, orderBy: { createdAt: 'desc' }, take: 50, select: SEATING_JOB_SUMMARY });
  }
  async findOne(eventId: string, id: string) {
    const job = await this.prisma.seatingJob.findFirst({ where: { id, eventId } });
    if (!job) throw new NotFoundException('No such seating job on this event');
    return seatingJobView(job);
  }
}

function seatingJobView(job: SeatingJob) {
  const { id, arrangementId, status, attempts, failureReason, snapshotAt, attendanceRevision, arrangementRevision, appliedRevision, result, createdAt, completedAt } = job;
  return { id, arrangementId, status, attempts, failureReason, snapshotAt, attendanceRevision, arrangementRevision, appliedRevision, result, createdAt, completedAt };
}

// History stays small even if many past jobs could not seat thousands of households.
const SEATING_JOB_SUMMARY = { id: true, arrangementId: true, status: true, attempts: true, failureReason: true,
  snapshotAt: true, attendanceRevision: true, arrangementRevision: true, appliedRevision: true, createdAt: true, completedAt: true,
} satisfies Prisma.SeatingJobSelect;
