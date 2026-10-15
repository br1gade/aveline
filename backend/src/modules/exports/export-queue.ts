import { Injectable } from '@nestjs/common';
import { ExportSnapshot, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export const EXPORT_LEASE_MS = 90_000;
export const EXPORT_ATTEMPTS = 3;
export function ownedExport(job: ExportSnapshot): Prisma.ExportSnapshotWhereInput {
  return { id: job.id, status: 'RUNNING', leaseOwner: job.leaseOwner, leaseUntil: { gt: new Date() }, revokedAt: null };
}

@Injectable()
export class ExportQueue {
  constructor(private readonly prisma: PrismaService) {}

  async claim(): Promise<ExportSnapshot | null> {
    const owner = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE export_snapshots SET status = 'FAILED', "failureReason" = 'LEASE_EXHAUSTED', "leaseOwner" = NULL, "leaseUntil" = NULL
        WHERE status = 'RUNNING' AND "leaseUntil" < now() AND attempts >= ${EXPORT_ATTEMPTS}`;
      const rows = await tx.$queryRaw<ExportSnapshot[]>`UPDATE export_snapshots SET status = 'RUNNING', attempts = attempts + 1,
        "leaseOwner" = ${owner}, "leaseUntil" = now() + (${EXPORT_LEASE_MS} * interval '1 millisecond'), "failureReason" = NULL
        WHERE id = (SELECT id FROM export_snapshots WHERE "revokedAt" IS NULL AND attempts < ${EXPORT_ATTEMPTS}
          AND ((status = 'QUEUED' AND "nextAttemptAt" <= now()) OR (status = 'RUNNING' AND "leaseUntil" < now()))
          ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
      return rows[0] ?? null;
    });
  }

  async renew(job: ExportSnapshot): Promise<boolean> {
    const result = await this.prisma.exportSnapshot.updateMany({ where: ownedExport(job), data: { leaseUntil: new Date(Date.now() + EXPORT_LEASE_MS) } });
    return result.count === 1;
  }

  async fail(job: ExportSnapshot, code: string): Promise<boolean> {
    const result = await this.prisma.exportSnapshot.updateMany({ where: ownedExport(job), data: {
      status: job.attempts >= EXPORT_ATTEMPTS ? 'FAILED' : 'QUEUED', failureReason: code,
      leaseOwner: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** job.attempts)),
    } });
    return result.count === 1;
  }
}
