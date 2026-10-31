import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isUniqueViolation } from '../../../common/prisma-errors';
import { ImportStatus, MessageChannel, Prisma, SuppressionReason } from '@prisma/client';
import { addressFingerprint } from '../../communications/address-form';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ParsedGuest,
  RowError,
  TooManyRowsError,
  decodeGuestCsv,
  parseGuestCsv,
} from './csv-guests';
import {
  HOUSEHOLDS_PER_BATCH,
  HouseholdInFile,
  describeImportError,
  importHouseholds,
} from './household-import';

/** A batch of a hundred households is a few queries; this is room, not a target. */
const BATCH_TIMEOUT_MS = 30_000;

/** A run still PROCESSING after this long was interrupted. */
const STALE_IMPORT_MS = 10 * 60 * 1000;


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
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, organizationId: true, locales: true } });
    if (!event) throw new NotFoundException(`No event ${eventId}`);

    const parsed = readGuestList(content);
    const { guests, refused } = await this.withoutErased(event.organizationId, withPublishedLocales(parsed.guests, event.locales));
    const errors = [...parsed.errors, ...refused];
    const seatsInFile = seatsStatedPerHousehold(guests);

    const record = await this.startImport({ eventId, filename, rowsTotal: guests.length + errors.length, uploadedBy });

    const failures = [...errors];
    let imported = 0;

    for (const batch of inBatches(groupByHousehold(guests), HOUSEHOLDS_PER_BATCH)) {
      try {
        const outcome = await this.prisma.$transaction((tx) => importHouseholds(tx, eventId, batch, seatsInFile), { timeout: BATCH_TIMEOUT_MS });
        imported += outcome.imported;
        failures.push(...outcome.failures);
      } catch (error) {
        // The full error goes to our logs; the history gets only what is safe to show.
        this.logger.warn(`import ${record.id} batch from row ${batch[0][0].row}: ${error instanceof Error ? error.message : String(error)}`);
        failures.push(...batch.flat().map((guest) => ({ row: guest.row, message: `Could not save ${guest.firstName}: ${describeImportError(error)}` })));
      }
    }

    return this.finish(record.id, imported, failures.sort((a, b) => a.row - b.row));
  }

  /**
   * Rows for people whose data was erased from this organization's events
   * (decided 10 October 2026, D21). Re-importing the original spreadsheet
   * brought them straight back; their addresses are kept only as hashes, so
   * each row's address is hashed and checked against them.
   */
  private async withoutErased(organizationId: string, guests: ParsedGuest[]) {
    const fingerprintsOf = (guest: ParsedGuest) => [
      ...(guest.email ? [addressFingerprint(MessageChannel.EMAIL, guest.email)] : []),
      ...(guest.phone ? [addressFingerprint(MessageChannel.SMS, guest.phone)] : []),
    ];
    const candidates = [...new Set(guests.flatMap(fingerprintsOf))];
    if (candidates.length === 0) return { guests, refused: [] };

    const erased = await this.prisma.suppression.findMany({
      where: { organizationId, reason: SuppressionReason.ERASED, address: { in: candidates } },
      select: { address: true },
    });
    const erasedSet = new Set(erased.map((row) => row.address));
    const isErased = (guest: ParsedGuest) => fingerprintsOf(guest).some((fingerprint) => erasedSet.has(fingerprint));
    return {
      guests: guests.filter((guest) => !isErased(guest)),
      refused: guests.filter(isErased).map((guest) => ({
        row: guest.row,
        message: 'This person asked for their data to be erased and cannot be added again',
      })),
    };
  }

  /**
   * Claims the event's one running import. A partial unique index allows one
   * PROCESSING import per event: two at once — a double upload, a retry —
   * each found no household by name and created one, duplicating the list.
   * A run left PROCESSING by a crash is closed after ten minutes.
   */
  private async startImport(input: { eventId: string; filename: string; rowsTotal: number; uploadedBy?: string }) {
    await this.prisma.guestImport.updateMany({
      where: { eventId: input.eventId, status: ImportStatus.PROCESSING, createdAt: { lt: new Date(Date.now() - STALE_IMPORT_MS) } },
      data: { status: ImportStatus.FAILED, finishedAt: new Date() },
    });
    try {
      return await this.prisma.guestImport.create({
        data: { ...input, uploadedBy: input.uploadedBy ?? null, status: ImportStatus.PROCESSING },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An import of this guest list is already running; try again when it finishes');
      }
      throw error;
    }
  }

  listImports(eventId: string) {
    return this.prisma.guestImport.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  private async finish(importId: string, imported: number, failures: RowError[]) {
    const status = importStatusFor(imported, failures.length);

    const record = await this.prisma.guestImport.update({
      where: { id: importId },
      data: {
        status,
        rowsImported: imported,
        rowsFailed: failures.length,
        // The history is read with guest:read alone and outlives erasure, so a
        // mistyped address is quoted to the importer below and never kept.
        errors: failures.map(withoutContact) as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });

    this.logger.log(`import ${importId}: ${imported} imported, ${failures.length} failed`);
    return {
      importId: record.id,
      status: record.status,
      rowsImported: record.rowsImported,
      rowsFailed: record.rowsFailed,
      errors: failures.map(({ isContact: _isContact, ...error }) => error),
    };
  }
}

function withoutContact({ isContact, value, ...error }: RowError): RowError {
  return isContact ? error : { ...error, ...(value === undefined ? {} : { value }) };
}

/** Nothing failed, nothing worked, or somewhere in between. */
function importStatusFor(imported: number, failed: number): ImportStatus {
  if (failed === 0) return ImportStatus.COMPLETED;
  return imported === 0 ? ImportStatus.FAILED : ImportStatus.PARTIAL;
}

/**
 * A language the event does not publish is left out rather than refusing the
 * row: the guest still matters more than a column, and their messages fall
 * back to the event's language. Adding a guest by hand refuses it instead,
 * since a person typing can correct it.
 */
function withPublishedLocales(guests: ParsedGuest[], locales: string[]): ParsedGuest[] {
  return guests.map((guest) => (guest.locale && !locales.includes(guest.locale) ? { ...guest, locale: undefined } : guest));
}

function readGuestList(content: Buffer) {
  const decoded = decodeGuestCsv(content);
  if ('error' in decoded) return { guests: [], errors: [{ row: 0, message: decoded.error }] };
  try {
    return parseGuestCsv(decoded.text);
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

/** Rows grouped by household, in the order each household first appears. */
function groupByHousehold(guests: ParsedGuest[]): ParsedGuest[][] {
  const groups = new Map<string, ParsedGuest[]>();
  for (const guest of guests) groups.set(guest.household, [...(groups.get(guest.household) ?? []), guest]);
  return [...groups.values()];
}

function inBatches<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}
