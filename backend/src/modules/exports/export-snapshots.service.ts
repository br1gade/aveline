import { lockEventOrganization } from '../../infra/auth/access-locks';
import { EXPORT_TYPES } from './renderers/export-document';
import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ExportSnapshot } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivateStorageService } from '../../infra/storage/private/private-storage';
import { exportAccess, lockExportAccess } from './export-access';
import { CreateExportSnapshotDto } from './dto/export-snapshot.dto';

@Injectable()
export class ExportSnapshotsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: PrivateStorageService) {}

  async create(eventId: string, userId: string, dto: CreateExportSnapshotDto) {
    const record = await this.prisma.$transaction(async (tx) => {
      await lockEventOrganization(tx, eventId);
      // Bounds queue admission across API replicas and concurrent requests.
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
      const access = await lockExportAccess(tx, eventId, userId);
      const hasContacts = resolveContacts(dto, access.canSeeContacts);
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { defaultLocale: true } });
      const data = { eventId, requestedByUserId: userId, idempotencyKey: dto.idempotencyKey, kind: dto.kind, format: dto.format ?? 'CSV',
        locale: dto.locale ?? event.defaultLocale, includesContacts: hasContacts };
      const existing = await tx.exportSnapshot.findUnique({ where: { eventId_requestedByUserId_idempotencyKey: { eventId, requestedByUserId: userId, idempotencyKey: dto.idempotencyKey } } });
      if (existing) return requireSameIntent(existing, data);
      const pending = await tx.exportSnapshot.count({ where: { eventId, status: { in: ['QUEUED', 'RUNNING'] } } });
      if (pending >= 10) throw new ConflictException('This event already has 10 active exports; wait for completion');
      return tx.exportSnapshot.create({ data });
    });
    return snapshotView(record);
  }

  async list(eventId: string) {
    return (await this.prisma.exportSnapshot.findMany({ where: { eventId }, orderBy: { createdAt: 'desc' }, take: 50 })).map(snapshotView);
  }

  async findOne(eventId: string, snapshotId: string) { return snapshotView(await this.requireSnapshot(eventId, snapshotId)); }

  async download(eventId: string, snapshotId: string, userId: string) {
    const record = await this.requireSnapshot(eventId, snapshotId);
    await this.assertDownload(record, userId);
    let buffer: Buffer;
    try { buffer = await this.storage.get(record.artifactKey!); }
    catch { throw new ServiceUnavailableException('Private export storage is temporarily unavailable'); }
    // Storage IO holds no database locks. Recheck standing and revocation after it.
    await this.assertDownload(await this.requireSnapshot(eventId, snapshotId), userId);
    return { buffer, mimeType: EXPORT_TYPES[record.format].mimeType,
      filename: `${record.kind.toLowerCase().replace(/_/g, '-')}-${record.id}.${EXPORT_TYPES[record.format].extension}` };
  }

  private async requireSnapshot(eventId: string, id: string) {
    const record = await this.prisma.exportSnapshot.findFirst({ where: { id, eventId } });
    if (!record) throw new NotFoundException('No such export snapshot on this event');
    return record;
  }

  private async assertDownload(record: ExportSnapshot, userId: string): Promise<void> {
    const access = await exportAccess(this.prisma, record.eventId, userId);
    if (record.revokedAt) throw new GoneException('This snapshot was revoked; regenerate it');
    if (record.expiresAt && record.expiresAt <= new Date()) throw new GoneException('This snapshot expired; regenerate it');
    if ((record.includesContacts || record.kind === 'TICKET_MANIFEST') && !access.canSeeContacts) throw new ForbiddenException('This artifact needs guest contact permission; regenerate a redacted export');
    if (record.status !== 'COMPLETED' || !record.artifactKey) throw new ConflictException('This snapshot is not ready to download');
  }
}

function requireSameIntent(existing: ExportSnapshot, data: Pick<ExportSnapshot, 'kind' | 'format' | 'locale' | 'includesContacts'>) {
  if (existing.format !== data.format || existing.kind !== data.kind || existing.locale !== data.locale || existing.includesContacts !== data.includesContacts) throw new ConflictException('This idempotency key belongs to another export intent');
  return existing;
}

function snapshotView(record: ExportSnapshot) {
  const { id, eventId, kind, format, locale, includesContacts: hasContacts, status, attempts, failureReason, snapshotAt,
    timezone, attendanceRevision, dataRevision, expiresAt, revokedAt, createdAt, completedAt } = record;
  const isReady = status === 'COMPLETED' && !!record.artifactKey && !revokedAt && !!expiresAt && expiresAt > new Date();
  return { id, kind, format, locale, includesContacts: hasContacts, status, attempts, failureReason, snapshotAt, timezone,
    attendanceRevision, dataRevision, expiresAt, revokedAt, createdAt, completedAt,
    downloadPath: isReady ? `/api/v1/events/${eventId}/export-snapshots/${id}/download` : null };
}


function resolveContacts(dto: CreateExportSnapshotDto, canSeeContacts: boolean): boolean {
  const hasContacts = dto.includesContacts ?? canSeeContacts;
  if ((hasContacts || dto.kind === 'TICKET_MANIFEST') && !canSeeContacts) throw new ForbiddenException('This export needs guest contact permission');
  if (dto.kind === 'TICKET_MANIFEST' && !hasContacts) throw new BadRequestException('A ticket manifest cannot be redacted');
  return hasContacts;
}
