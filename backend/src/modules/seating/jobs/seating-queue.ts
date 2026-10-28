import { Injectable } from '@nestjs/common';
import { Prisma, SeatingJob } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';

export const SEATING_LEASE_MS = 90_000;
export const SEATING_ATTEMPTS = 3;
export function ownedSeating(job: SeatingJob): Prisma.SeatingJobWhereInput {
  return { id: job.id, status: 'RUNNING', leaseOwner: job.leaseOwner, leaseUntil: { gt: new Date() } };
}
export class SeatingJobError extends Error {
  constructor(readonly code: string, readonly isPermanent = false) { super(code); }
}

@Injectable()
export class SeatingQueue {
  constructor(private readonly prisma: PrismaService) {}
  async claim(): Promise<SeatingJob | null> {
    const owner = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE seating_jobs SET status = 'FAILED', "failureReason" = 'LEASE_EXHAUSTED',
        "leaseOwner" = NULL, "leaseUntil" = NULL, "completedAt" = now()
        WHERE status = 'RUNNING' AND "leaseUntil" < now() AND attempts >= ${SEATING_ATTEMPTS}`;
      const rows = await tx.$queryRaw<SeatingJob[]>`UPDATE seating_jobs SET status = 'RUNNING', attempts = attempts + 1,
        "leaseOwner" = ${owner}, "leaseUntil" = now() + (${SEATING_LEASE_MS} * interval '1 millisecond'), "failureReason" = NULL
        WHERE id = (SELECT id FROM seating_jobs WHERE attempts < ${SEATING_ATTEMPTS}
          AND ((status = 'QUEUED' AND "nextAttemptAt" <= now()) OR (status = 'RUNNING' AND "leaseUntil" < now()))
          ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
      return rows[0] ?? null;
    });
  }
  async renew(job: SeatingJob): Promise<boolean> {
    return (await this.prisma.seatingJob.updateMany({ where: ownedSeating(job), data: { leaseUntil: new Date(Date.now() + SEATING_LEASE_MS) } })).count === 1;
  }
  async fail(job: SeatingJob, error: SeatingJobError): Promise<void> {
    const hasFinished = error.isPermanent || job.attempts >= SEATING_ATTEMPTS;
    await this.prisma.seatingJob.updateMany({ where: ownedSeating(job), data: {
      status: hasFinished ? 'FAILED' : 'QUEUED', failureReason: error.code, completedAt: hasFinished ? new Date() : null,
      leaseOwner: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** job.attempts)),
    } });
  }
}
