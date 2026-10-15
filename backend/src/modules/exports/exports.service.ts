import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExportFormat,
  ExportKind,
  ExportStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationsService } from '../operations/operations.service';
import { toCsv } from './csv';
import { ExportSheets } from './export-sheets';
import { CreateExportDto } from './dto/export.dto';

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsService,
  ) {}

  list(eventId: string) {
    return this.prisma.export
      .findMany({ where: { eventId }, orderBy: { createdAt: 'desc' }, take: 50, select: EXPORT_SUMMARY })
      .then((exports) => exports.map((record) => withDownload(eventId, record)));
  }

  /**
   * Records an export; the file itself is built when it is downloaded.
   *
   * Decided 9 October 2026: exports are downloaded through the app by someone
   * signed in with permission, never left at a public link. They used to be
   * stored at a public URL that never expired — a guest list with every phone
   * number, a manifest of valid door codes — readable by anyone the link
   * reached. The record stays as the history of who exported what, and when.
   */
  async create(eventId: string, userId: string, dto: CreateExportDto, canSeeContacts: boolean) {
    const format = dto.format ?? ExportFormat.CSV;
    if (format !== ExportFormat.CSV) {
      throw new BadRequestException(`${format} is not available yet; CSV is. See docs/GAPS.md`);
    }
    assertMaySee(dto.kind, canSeeContacts);

    const record = await this.prisma.export.create({
      data: {
        eventId,
        kind: dto.kind,
        format,
        status: ExportStatus.COMPLETED,
        requestedByUserId: userId,
        completedAt: new Date(),
      },
      select: EXPORT_SUMMARY,
    });
    return withDownload(eventId, record);
  }

  async findOne(eventId: string, exportId: string) {
    return withDownload(eventId, await this.requireExport(eventId, exportId));
  }

  /**
   * The file, built now from the event as it is. Contact columns only for a
   * caller who may see them; a manifest of door codes not at all otherwise.
   * This compatibility surface stays live until the frontend adopts the
   * explicit export-snapshots queue. These audit rows cannot recreate history.
   */
  async download(eventId: string, exportId: string, canSeeContacts: boolean) {
    const record = await this.requireExport(eventId, exportId);
    assertMaySee(record.kind, canSeeContacts);

    const sheet = await new ExportSheets(this.prisma, this.operations).build(eventId, record.kind);
    const columns = canSeeContacts ? sheet.columns : sheet.columns.filter((column) => !CONTACT_COLUMNS.has(column));
    return {
      filename: `${record.kind.toLowerCase().replace(/_/g, '-')}-${record.id}.csv`,
      csv: toCsv(columns, sheet.rows),
    };
  }

  private async requireExport(eventId: string, exportId: string) {
    const record = await this.prisma.export.findFirst({ where: { id: exportId, eventId }, select: EXPORT_SUMMARY });
    if (!record) throw new NotFoundException('No such export on this event');
    return record;
  }

}

const EXPORT_SUMMARY = {
  id: true,
  kind: true,
  format: true,
  status: true,
  failureReason: true,
  createdAt: true,
  completedAt: true,
} satisfies Prisma.ExportSelect;

/** Guest contact details, shown only to a caller with guest:contact:read. */
const CONTACT_COLUMNS: ReadonlySet<string> = new Set(['Email', 'Phone']);

/** Valid door codes and buyers' emails: contact data and a way in, both. */
const CONTACT_ONLY_KINDS: ReadonlySet<ExportKind> = new Set([ExportKind.TICKET_MANIFEST]);

function assertMaySee(kind: ExportKind, canSeeContacts: boolean): void {
  if (CONTACT_ONLY_KINDS.has(kind) && !canSeeContacts) {
    throw new ForbiddenException(`A ${kind.toLowerCase().replace(/_/g, ' ')} export needs guest:contact:read`);
  }
}

/** Where the signed-in client fetches the file. Not a public link: it needs the same authorization. */
function withDownload<T extends { id: string }>(eventId: string, record: T) {
  return { ...record, isSnapshot: false, requiresRegeneration: true, downloadPath: `/api/v1/events/${eventId}/exports/${record.id}/download` };
}
