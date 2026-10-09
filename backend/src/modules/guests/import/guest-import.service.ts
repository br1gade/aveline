import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GuestAttribution, ImportStatus, Prisma } from '@prisma/client';
import { newGuestToken } from '../guest-token';
import { PrismaService } from '../../../prisma/prisma.service';
import { capacityProblem } from '../guest-rules';
import { LockedHousehold, lockHousehold } from '../household-lock';
import { ParsedGuest, RowError, TooManyRowsError, parseGuestCsv } from './csv-guests';

/** What the file says about one household: the seats it states, and how many it names. */
interface HouseholdInFile {
  stated?: number;
  named: number;
}

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

    const { guests, errors } = readGuestList(content);
    const seatsInFile = seatsStatedPerHousehold(guests);

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
        await this.upsertGuest(eventId, guest, seatsInFile);
        imported += 1;
      } catch (error) {
        failures.push({ row: guest.row, message: `Could not save ${guest.firstName}: ${describeError(error)}` });
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
   * phone number by hand since the first import, and a guest may have said
   * which side invited them.
   */
  private async upsertGuest(eventId: string, guest: ParsedGuest, seatsInFile: Map<string, HouseholdInFile>) {
    const householdId = await this.findOrCreateHousehold(eventId, guest, seatsInFile);

    const existing = await this.prisma.guest.findFirst({
      where: { eventId, householdId, firstName: guest.firstName, lastName: guest.lastName ?? null },
    });

    if (existing) {
      await this.prisma.guest.update({
        where: { id: existing.id },
        data: {
          email: guest.email ?? existing.email,
          phone: guest.phone ?? existing.phone,
          locale: guest.locale ?? existing.locale,
          attribution: guest.attribution ?? existing.attribution,
        },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // Locked, as the guest API does, so the count is still true when written.
      const household = await lockHousehold(tx, eventId, householdId);
      await makeRoom(tx, household, seatsInFile.get(guest.household));
      await tx.guest.create({
        data: {
          eventId,
          householdId,
          firstName: guest.firstName,
          lastName: guest.lastName ?? null,
          email: guest.email ?? null,
          phone: guest.phone ?? null,
          locale: guest.locale ?? null,
          attribution: guest.attribution ?? GuestAttribution.UNKNOWN,
          token: newGuestToken(),
          // The first person listed for a household holds its invitation
          // link; the rest are family on the same link.
          isPrimary: household.namedGuests === 0,
          // An imported guest was given to us by the host, which is the lawful
          // basis we record (spec §GDPR). Not a guest's own consent.
          consentAt: new Date(),
          consentSource: 'host-import',
          rsvp: { create: {} },
        },
      });
    });
  }

  private async findOrCreateHousehold(
    eventId: string,
    guest: ParsedGuest,
    seatsInFile: Map<string, HouseholdInFile>,
  ): Promise<string> {
    const existing = await this.prisma.household.findFirst({
      where: { eventId, name: guest.household },
      select: { id: true },
    });
    if (existing) return existing.id;

    const inFile = seatsInFile.get(guest.household);
    const created = await this.prisma.household.create({
      data: { eventId, name: guest.household, seatsAllotted: inFile?.stated ?? inFile?.named ?? 1 },
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

function readGuestList(content: Buffer) {
  try {
    return parseGuestCsv(content.toString('utf8'));
  } catch (error) {
    if (error instanceof TooManyRowsError) throw new BadRequestException(error.message);
    throw error;
  }
}

function seatsStatedPerHousehold(guests: ParsedGuest[]): Map<string, HouseholdInFile> {
  const households = new Map<string, HouseholdInFile>();
  for (const guest of guests) {
    const known = households.get(guest.household) ?? { named: 0 };
    households.set(guest.household, {
      stated: Math.max(known.stated ?? 0, guest.seatsAllotted ?? 0) || undefined,
      named: known.named + 1,
    });
  }
  return households;
}

/**
 * A seat for one more named guest, or the reason there is none.
 *
 * The same rule as adding a guest by hand: named guests never outnumber seats.
 * When the file states a household's seats, that is the host's word and a
 * row past it is reported. When it does not, the host has simply named the
 * people they are inviting, and the household grows to fit them.
 */
async function makeRoom(
  tx: Prisma.TransactionClient,
  household: LockedHousehold,
  inFile: HouseholdInFile | undefined,
): Promise<void> {
  const seats = seatsWithOneMore(household, inFile?.stated);
  if (seats !== household.seatsAllotted) {
    await tx.household.update({ where: { id: household.id }, data: { seatsAllotted: seats } });
  }
}

/** The household's seats once one more guest is named in it; throws if they cannot be. */
function seatsWithOneMore(household: LockedHousehold, stated: number | undefined): number {
  const needed = household.namedGuests + 1;
  if (stated === undefined) return Math.max(household.seatsAllotted, needed);

  // Never shrinks: a host who raised the seats by hand keeps them.
  const seats = Math.max(household.seatsAllotted, stated);
  const problem = capacityProblem(seats, needed);
  if (problem) throw new BadRequestException(problem);
  return seats;
}
