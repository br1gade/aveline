import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ImportStatus, Prisma } from '@prisma/client';
import { newGuestToken } from '../guest-token';
import { PrismaService } from '../../../prisma/prisma.service';
import { ParsedGuest, RowError, parseGuestCsv } from './csv-guests';

const MAX_ROWS = 2000;

@Injectable()
export class GuestImportService {
  private readonly logger = new Logger(GuestImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Imports a guest list from a CSV.
   *
   * Partial success is the point. A host with four hundred guests will have a
   * handful of bad rows, and failing the whole upload over them is how they
   * go back to a spreadsheet. Good rows are written, bad ones are recorded
   * against their row number, and the import is marked PARTIAL so the host
   * knows to look.
   *
   * Re-importing is safe: a household that already exists is reused rather
   * than duplicated, so fixing twelve rows means re-uploading the file, not
   * deleting everyone first.
   */
  async importCsv(eventId: string, filename: string, content: Buffer, uploadedBy?: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new NotFoundException(`No event ${eventId}`);

    const { guests, errors } = parseGuestCsv(content.toString('utf8'));
    if (guests.length > MAX_ROWS) {
      throw new BadRequestException(`At most ${MAX_ROWS} guests per import; this file has ${guests.length}`);
    }

    const record = await this.prisma.guestImport.create({
      data: {
        eventId,
        filename,
        status: ImportStatus.PROCESSING,
        rowsTotal: guests.length + errors.length,
        uploadedBy: uploadedBy ?? null,
      },
    });

    const failures = [...errors];
    let imported = 0;

    for (const guest of guests) {
      try {
        await this.upsertGuest(eventId, guest);
        imported += 1;
      } catch (error) {
        failures.push({
          row: 0,
          message: `Could not save ${guest.firstName}: ${describeError(error)}`,
        });
      }
    }

    return this.finish(record.id, imported, failures);
  }

  listImports(eventId: string) {
    return this.prisma.guestImport.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  /**
   * One CSV row into the guest graph.
   *
   * Re-importing a corrected spreadsheet must not duplicate anyone, so a
   * household is matched by name and a guest by name within it. Updating
   * never clears a field the CSV left blank — the host may have filled in a
   * phone number by hand since the first import.
   */
  private async upsertGuest(eventId: string, guest: ParsedGuest) {
    const householdId = await this.findOrCreateHousehold(eventId, guest);

    const existing = await this.prisma.guest.findFirst({
      where: {
        eventId,
        householdId,
        firstName: guest.firstName,
        lastName: guest.lastName ?? null,
      },
    });

    if (existing) {
      await this.prisma.guest.update({
        where: { id: existing.id },
        data: {
          email: guest.email ?? existing.email,
          phone: guest.phone ?? existing.phone,
          locale: guest.locale ?? existing.locale,
          attribution: guest.attribution,
        },
      });
      return;
    }

    // The first person listed for a household holds its invitation link; the
    // rest are family on the same link, not separate invitees.
    const isFirstInHousehold = (await this.prisma.guest.count({ where: { householdId } })) === 0;

    await this.prisma.guest.create({
      data: {
        eventId,
        householdId,
        firstName: guest.firstName,
        lastName: guest.lastName ?? null,
        email: guest.email ?? null,
        phone: guest.phone ?? null,
        locale: guest.locale ?? null,
        attribution: guest.attribution,
        token: newGuestToken(),
        isPrimary: isFirstInHousehold,
        // An imported guest was given to us by the host, which is the lawful
        // basis we record (spec §GDPR). Not a guest's own consent.
        consentAt: new Date(),
        consentSource: 'host-import',
        rsvp: { create: {} },
      },
    });
  }

  private async findOrCreateHousehold(eventId: string, guest: ParsedGuest): Promise<string> {
    const existing = await this.prisma.household.findFirst({
      where: { eventId, name: guest.household },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.household.create({
      data: { eventId, name: guest.household, seatsAllotted: guest.seatsAllotted },
      select: { id: true },
    });
    return created.id;
  }

  private async finish(importId: string, imported: number, failures: RowError[]) {
    const status = importStatusFor(imported, failures.length);

    const record = await this.prisma.guestImport.update({
      where: { id: importId },
      data: {
        status,
        rowsImported: imported,
        rowsFailed: failures.length,
        errors: failures as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });

    this.logger.log(`import ${importId}: ${imported} imported, ${failures.length} failed`);
    return {
      importId: record.id,
      status: record.status,
      rowsImported: record.rowsImported,
      rowsFailed: record.rowsFailed,
      errors: failures,
    };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Nothing failed, nothing worked, or somewhere in between. */
function importStatusFor(imported: number, failed: number): ImportStatus {
  if (failed === 0) return ImportStatus.COMPLETED;
  return imported === 0 ? ImportStatus.FAILED : ImportStatus.PARTIAL;
}
