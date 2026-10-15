import { Injectable, Logger } from '@nestjs/common';
import { ExportSnapshot, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivateStorageService } from '../../infra/storage/private/private-storage';
import { OperationsService } from '../operations/operations.service';
import { exportAccess } from './export-access';
import { lockExportPrivacy, rememberExportSubjects } from './export-privacy';
import { ExportQueue, EXPORT_LEASE_MS, ownedExport } from './export-queue';
import { ExportSheets } from './export-sheets';
import { toCsv } from './csv';

const MAX_BYTES = 10 * 1024 * 1024;

@Injectable()
export class ExportRunner {
  private readonly logger = new Logger(ExportRunner.name);
  constructor(private readonly prisma: PrismaService, private readonly queue: ExportQueue,
    private readonly storage: PrivateStorageService, private readonly operations: OperationsService) {}

  async runOne(): Promise<boolean> {
    const job = await this.queue.claim();
    if (!job) return false;
    await this.process(job);
    return true;
  }

  async process(job: ExportSnapshot): Promise<void> {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const input = await this.capture(job);
      heartbeat = setInterval(() => { void this.queue.renew(job).catch(() => false); }, 15_000);
      // The repeatable read has ended: no DB locks during encoding or upload.
      const columns = job.includesContacts ? input.sheet.columns : input.sheet.columns.filter((column) => !['Email', 'Phone'].includes(column));
      if (input.sheet.rows.length > 20_000) throw new Error('Export row limit exceeded');
      const buffer = Buffer.from(toCsv(columns, input.sheet.rows), 'utf8');
      if (buffer.length > MAX_BYTES) throw new Error('Export byte limit exceeded');
      const key = randomUUID();
      if (!await this.reserveArtifact(job, key)) return;
      await this.storage.put(key, buffer, 'text/csv; charset=utf-8');
      await this.publish(job, key);
    } catch {
      await this.queue.fail(job, 'GENERATION_FAILED');
      this.logger.warn({ jobId: job.id, attempt: job.attempts, code: 'GENERATION_FAILED' });
    } finally { if (heartbeat) clearInterval(heartbeat); }
  }

  private capture(job: ExportSnapshot) {
    return this.prisma.$transaction(async (tx) => {
      await lockExportPrivacy(tx);
      await this.assertMayRun(tx, job);
      await assertCaptureBounds(tx, job.eventId);
      const event = await tx.event.findUniqueOrThrow({ where: { id: job.eventId }, select: { timezone: true, attendanceRevision: true } });
      const [revision] = await tx.$queryRaw<{ value: string; at: Date }[]>`SELECT txid_current_snapshot()::text AS value, current_timestamp AS at`;
      const sheet = await new ExportSheets(tx, this.operations.inTransaction(tx, job.locale), job.locale).build(job.eventId, job.kind);
      await rememberExportSubjects(tx, job);
      const update = await tx.exportSnapshot.updateMany({ where: ownedExport(job), data: {
        snapshotAt: revision.at, timezone: event.timezone, attendanceRevision: event.attendanceRevision, dataRevision: revision.value,
      } });
      if (!update.count) throw new Error('Export lease lost');
      return { sheet };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000, maxWait: 5000 });
  }

  private async assertMayRun(tx: Prisma.TransactionClient, job: ExportSnapshot): Promise<void> {
    if (!await tx.exportSnapshot.findFirst({ where: ownedExport(job), select: { id: true } })) throw new Error('Export lease lost');
    const access = await exportAccess(tx, job.eventId, job.requestedByUserId);
    if ((job.includesContacts || job.kind === 'TICKET_MANIFEST') && !access.canSeeContacts) throw new Error('Export permission changed');
  }

  private reserveArtifact(job: ExportSnapshot, key: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const renewed = await tx.exportSnapshot.updateMany({ where: ownedExport(job), data: { leaseUntil: new Date(Date.now() + EXPORT_LEASE_MS) } });
      if (!renewed.count) return false;
      await tx.exportArtifact.create({ data: { key, snapshotId: job.id, cleanupAfter: new Date(Date.now() + EXPORT_LEASE_MS * 2) } });
      return true;
    });
  }

  private publish(job: ExportSnapshot, key: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await lockExportPrivacy(tx);
      await this.assertMayRun(tx, job);
      const expiresAt = new Date(Date.now() + Number(process.env.EXPORT_RETENTION_DAYS ?? 7) * 86_400_000);
      const result = await tx.exportSnapshot.updateMany({ where: ownedExport(job), data: {
        status: 'COMPLETED', artifactKey: key, expiresAt, completedAt: new Date(), leaseOwner: null, leaseUntil: null,
      } });
      if (!result.count) throw new Error('Export lease lost');
      const artifact = await tx.exportArtifact.updateMany({ where: { key, isRetired: false }, data: { cleanupAfter: expiresAt } });
      if (!artifact.count) throw new Error('Export artifact was retired');
    });
  }

  async cleanup(): Promise<void> {
    const records = await this.prisma.exportArtifact.findMany({ where: { OR: [{ cleanupAfter: { lte: new Date() } },
      { snapshotId: null, deletedAt: null }, { snapshot: { revokedAt: { not: null } }, deletedAt: null },
      { snapshot: { expiresAt: { lte: new Date() } }, deletedAt: null }] }, orderBy: { cleanupAfter: 'asc' }, take: 50 });
    // A bounded batch of independent storage deletes. Tombstones survive late uploads.
    await Promise.all(records.map(async (record) => {
      try {
        const retired = await this.prisma.exportArtifact.updateMany({ where: { key: record.key,
          OR: [{ snapshotId: null }, { snapshot: { revokedAt: { not: null } } },
            { snapshot: { expiresAt: { lte: new Date() } } },
            { cleanupAfter: { lte: new Date() }, NOT: { snapshot: { status: 'RUNNING', leaseUntil: { gt: new Date() } } } }],
        }, data: { isRetired: true } });
        if (!retired.count) return;
        await this.storage.remove(record.key);
        await this.prisma.exportArtifact.updateMany({ where: { key: record.key }, data: {
          deletedAt: new Date(), cleanupAfter: new Date(Date.now() + 60_000),
        } });
      } catch { this.logger.warn({ code: 'EXPORT_CLEANUP_RETRY' }); }
    }));
  }
}

async function assertCaptureBounds(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const counts = await Promise.all([
    tx.guest.count({ where: { eventId } }), tx.ticket.count({ where: { eventId } }),
    tx.seat.count({ where: { guest: { eventId } } }), tx.ticketOrder.count({ where: { eventId } }),
    tx.orderAttendee.count({ where: { order: { eventId } } }), tx.table.count({ where: { eventId } }),
  ]);
  const questions = await tx.rsvpQuestion.count({ where: { invitation: { eventId } } });
  const answers = await tx.rsvpAnswer.count({ where: { rsvp: { guest: { eventId } } } });
  if (counts.some((count) => count > 5000) || questions > 200 || answers > 100_000) throw new Error('Event exceeds worker input limit');
}
