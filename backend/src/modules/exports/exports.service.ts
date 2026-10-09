import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExportFormat,
  ExportKind,
  ExportStatus,
  Prisma,
  QuestionType,
  RsvpStatus,
  TicketOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveTranslation } from '../../common/locale';
import { OperationsService } from '../operations/operations.service';
import { formatAnswer, optionLabels } from '../rsvp/answer-display';
import { CsvRow, toCsv } from './csv';
import { CreateExportDto } from './dto/export.dto';

/** What each export contains, in the order the columns appear. */
interface Sheet { columns: string[]; rows: CsvRow[] }

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
   * A CSV of a few hundred rows is a handful of queries, so it is built
   * inline; a PDF, when it arrives, will be queued and use `status`.
   */
  async download(eventId: string, exportId: string, canSeeContacts: boolean) {
    const record = await this.requireExport(eventId, exportId);
    assertMaySee(record.kind, canSeeContacts);

    const sheet = await this.build(eventId, record.kind);
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

  /** One builder per kind; adding an export is adding a row. */
  private build(eventId: string, kind: ExportKind): Promise<Sheet> {
    const builders: Record<ExportKind, () => Promise<Sheet>> = {
      [ExportKind.GUEST_LIST]: () => this.guestList(eventId),
      [ExportKind.SEATING_CHART]: () => this.seatingChart(eventId),
      [ExportKind.PLACE_CARDS]: () => this.placeCards(eventId),
      [ExportKind.CATERING_SHEET]: () => this.cateringSheet(eventId),
      [ExportKind.BAR_SHEET]: () => this.barSheet(eventId),
      [ExportKind.PLAYLIST]: () => this.playlist(eventId),
      [ExportKind.TICKET_MANIFEST]: () => this.ticketManifest(eventId),
    };

    return builders[kind]();
  }

  private async guestList(eventId: string): Promise<Sheet> {
    const [guests, questions] = await Promise.all([
      this.prisma.guest.findMany({
        where: { eventId },
        include: {
          household: { select: { name: true, seatsAllotted: true } },
          rsvp: {
            select: {
              status: true,
              dietary: true,
              dietaryNotes: true,
              drinkPreference: true,
              answers: { select: { questionId: true, value: true } },
            },
          },
          seat: { include: { table: { select: { name: true } } } },
          checkIn: { select: { arrivedAt: true } },
        },
        orderBy: [{ household: { name: 'asc' } }, { isPrimary: 'desc' }, { firstName: 'asc' }],
      }),
      this.questionColumns(eventId),
    ]);

    return {
      columns: [
        'Household', 'First name', 'Last name', 'Email', 'Phone', 'Side',
        'Seats allotted', 'RSVP', 'Dietary', 'Dietary notes', 'Drink', 'Table', 'Arrived',
        ...questions.map((question) => question.heading),
      ],
      rows: guests.map((guest) => ({
        Household: guest.household.name,
        'First name': guest.firstName,
        'Last name': guest.lastName,
        Email: guest.email,
        Phone: guest.phone,
        Side: guest.attribution,
        'Seats allotted': guest.household.seatsAllotted,
        RSVP: guest.rsvp?.status ?? RsvpStatus.PENDING,
        Dietary: guest.rsvp?.dietary.join('; '),
        // An allergy written in a note is the line a kitchen most needs.
        'Dietary notes': guest.rsvp?.dietaryNotes,
        Drink: guest.rsvp?.drinkPreference,
        Table: guest.seat?.table.name,
        Arrived: guest.checkIn?.arrivedAt.toISOString(),
        ...answerCells(questions, guest.rsvp?.answers ?? []),
      })),
    };
  }

  /** One column per host question, headed by its prompt in the event's language. */
  private async questionColumns(eventId: string): Promise<QuestionColumn[]> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        defaultLocale: true,
        invitation: {
          select: { questions: { orderBy: { sortOrder: 'asc' }, select: { id: true, type: true, prompt: true, options: true } } },
        },
      },
    });
    const locale = event?.defaultLocale ?? 'hy';

    return (event?.invitation?.questions ?? []).map((question, index) => ({
      ...question,
      // Numbered so two questions with the same wording do not share a column.
      heading: `Q${index + 1}: ${resolveTranslation<string>(question.prompt, locale, locale) ?? ''}`,
      labels: optionLabels(question.options, locale, locale),
    }));
  }

  private async seatingChart(eventId: string): Promise<Sheet> {
    const tables = await this.prisma.table.findMany({
      where: { eventId },
      include: {
        seats: {
          include: { guest: { select: { firstName: true, lastName: true } } },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      columns: ['Table', 'Capacity', 'Seated', 'Guest'],
      rows: tables.flatMap((table): CsvRow[] =>
        // A table with nobody at it still needs a line, or the venue setting
        // out the room will not know it exists.
        table.seats.length === 0
          ? [{ Table: table.name, Capacity: table.capacity, Seated: 0, Guest: null }]
          : table.seats.map((seat) => ({
              Table: table.name,
              Capacity: table.capacity,
              Seated: table.seats.length,
              Guest: fullName(seat.guest),
            })),
      ),
    };
  }

  /** One line per attending guest, which is what a printer wants. */
  private async placeCards(eventId: string): Promise<Sheet> {
    const guests = await this.prisma.guest.findMany({
      where: { eventId, rsvp: { status: RsvpStatus.ATTENDING } },
      include: { seat: { include: { table: { select: { name: true } } } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return {
      columns: ['Name', 'Table'],
      rows: guests.map((guest) => ({ Name: fullName(guest), Table: guest.seat?.table.name })),
    };
  }

  private async cateringSheet(eventId: string): Promise<Sheet> {
    const sheet = await this.operations.cateringSheet(eventId);

    return {
      columns: ['Requirement', 'Guests', 'Note'],
      rows: [
        { Requirement: 'Total covers', Guests: sheet.covers },
        ...sheet.requirements.map((item) => ({
          Requirement: item.requirement,
          Guests: item.count,
        })),
        // The on-screen sheet had these; the file handed to the venue did not.
        ...sheet.notes.map((note) => ({
          Requirement: 'Dietary note',
          Guests: `${note.guest} (${note.household})`,
          Note: note.note,
        })),
      ],
    };
  }

  private async barSheet(eventId: string): Promise<Sheet> {
    const sheet = await this.operations.barSheet(eventId);

    return {
      columns: ['Drink', 'Guests', 'Share %'],
      rows: sheet.preferences.map((item) => ({
        Drink: item.drink,
        Guests: item.guests,
        'Share %': item.share,
      })),
    };
  }

  private async playlist(eventId: string): Promise<Sheet> {
    const sheet = await this.operations.playlist(eventId);

    return {
      columns: ['Track', 'Requests'],
      rows: sheet.tracks.map((track) => ({ Track: track.track, Requests: track.requests })),
    };
  }

  /** Paid orders only: an unpaid reservation is not an admission. */
  private async ticketManifest(eventId: string): Promise<Sheet> {
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId, order: { status: TicketOrderStatus.PAID } },
      include: {
        ticketType: { select: { name: true } },
        order: { select: { buyerName: true, buyerEmail: true } },
      },
      orderBy: { issuedAt: 'asc' },
    });

    return {
      columns: ['Code', 'Type', 'Holder', 'Buyer', 'Buyer email', 'Status', 'Used at'],
      rows: tickets.map((ticket) => ({
        Code: ticket.code,
        Type: JSON.stringify(ticket.ticketType.name),
        Holder: ticket.holderName,
        Buyer: ticket.order.buyerName,
        'Buyer email': ticket.order.buyerEmail,
        Status: ticket.status,
        'Used at': ticket.usedAt?.toISOString(),
      })),
    };
  }
}

function fullName(person: { firstName: string; lastName: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

interface QuestionColumn {
  id: string;
  type: QuestionType;
  options: unknown;
  heading: string;
  labels: string[];
}

/** A guest's answers as words, one cell per question column. */
function answerCells(questions: QuestionColumn[], answers: { questionId: string; value: unknown }[]): CsvRow {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  return Object.fromEntries(
    questions.map((question) => {
      const value = byQuestion.get(question.id);
      return [question.heading, value === undefined ? undefined : formatAnswer(question, value, question.labels)];
    }),
  );
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
  return { ...record, downloadPath: `/api/v1/events/${eventId}/exports/${record.id}/download` };
}
