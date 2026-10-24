import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma, SeatingJob } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { clearRelease } from '../released-seat';
import { SeatingPlan } from '../seating-plan';
import { lockSeatingEvent, requireSeatingAccess } from './seating-access';
import { lockSeatingInputs } from './seating-apply-locks';
import { loadSeatingInput, SeatingInput } from './seating-input';
import { assertPlanFits } from './seating-plan-validation';
import { SeatingPlanner } from './seating-planner';
import { SeatingJobError, SeatingQueue, ownedSeating } from './seating-queue';

@Injectable()
export class SeatingRunner {
  private readonly logger = new Logger(SeatingRunner.name);
  constructor(private readonly prisma: PrismaService, private readonly queue: SeatingQueue, private readonly planner: SeatingPlanner) {}
  async runOne(): Promise<boolean> {
    const job = await this.queue.claim();
    if (!job) return false;
    await this.process(job);
    return true;
  }
  async process(job: SeatingJob): Promise<void> {
    const heartbeat = setInterval(() => { void this.queue.renew(job).catch(() => false); }, 15_000);
    try {
      const input = await this.capture(job);
      const started = Date.now();
      const plan = await this.planner.plan(input);
      if (Date.now() - started > 30_000) throw new SeatingJobError('PLANNING_LIMIT_EXCEEDED', true);
      await this.apply(job, input, plan);
    } catch (error) {
      const failure = classifyFailure(error);
      await this.queue.fail(job, failure);
      this.logger.warn({ jobId: job.id, attempt: job.attempts, code: failure.code });
    } finally { clearInterval(heartbeat); }
  }
  private capture(job: SeatingJob): Promise<SeatingInput> {
    return this.prisma.$transaction(async (tx) => {
      await requireSeatingAccess(tx, job.eventId, job.requestedByUserId);
      const input = await loadSeatingInput(tx, job.eventId, job.arrangementId);
      const result = await tx.seatingJob.updateMany({ where: ownedSeating(job), data: { snapshotAt: new Date(),
        attendanceRevision: input.attendanceRevision, arrangementRevision: input.arrangementRevision } });
      if (!result.count) throw new SeatingJobError('LEASE_LOST');
      return input;
    }, { isolationLevel: 'RepeatableRead', timeout: 20_000, maxWait: 5000 });
  }
  private apply(job: SeatingJob, captured: SeatingInput, plan: SeatingPlan): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      // Exclusive policy fence excludes RSVP, ticket and manual seating writers.
      await lockSeatingEvent(tx, job.eventId);
      await requireSeatingAccess(tx, job.eventId, job.requestedByUserId);
      await lockSeatingInputs(tx, job.eventId, job.arrangementId);
      await tx.$queryRaw`SELECT id FROM seating_arrangements WHERE id = ${job.arrangementId} FOR UPDATE`;
      const current = await loadSeatingInput(tx, job.eventId, job.arrangementId);
      if (current.arrangementRevision !== captured.arrangementRevision || current.attendanceRevision !== captured.attendanceRevision) throw new SeatingJobError('STATE_CHANGED');
      assertPlanFits(current, plan);
      const seats = plan.assignments.flatMap((assignment) => assignment.guestIds.map((guestId) => ({ guestId, tableId: assignment.tableId })));
      await tx.seat.createMany({ data: seats });
      await clearRelease(tx, seats.map((seat) => seat.guestId), job.arrangementId);
      await tx.$executeRaw`SET CONSTRAINTS seating_seats_revision, seating_releases_revision IMMEDIATE`;
      const revision = await tx.seatingArrangement.findUniqueOrThrow({ where: { id: job.arrangementId }, select: { revision: true } });
      const completed = await tx.seatingJob.updateMany({ where: ownedSeating(job), data: {
        status: 'COMPLETED', result: { seated: seats.length, households: plan.assignments.length, unseated: plan.unseated }, appliedRevision: revision.revision,
        completedAt: new Date(), leaseOwner: null, leaseUntil: null, failureReason: null,
      } });
      // A stale owner must roll back every seat, not just lose its status update.
      if (!completed.count) throw new SeatingJobError('LEASE_LOST');
    }, { timeout: 20_000, maxWait: 5000 });
  }
}
function classifyFailure(error: unknown): SeatingJobError {
  if (error instanceof SeatingJobError) return error;
  if (error instanceof ForbiddenException) return new SeatingJobError('ACCESS_REVOKED', true);
  if (error instanceof ConflictException) return new SeatingJobError('EVENT_UNAVAILABLE', true);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return new SeatingJobError('STATE_CHANGED');
  return new SeatingJobError('PLANNING_FAILED');
}
