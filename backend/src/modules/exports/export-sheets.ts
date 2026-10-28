import { venueOperationsSheet } from './export-venue-sheets';
import { ExportKind, Prisma, QuestionType, RsvpStatus, TicketOrderStatus } from '@prisma/client';
import { resolveTranslation } from '../../common/locale';
import { OperationsService } from '../operations/operations.service';
import { formatAnswer, optionLabels } from '../rsvp/answer-display';
import { SEAT_DETAIL, singleTable } from '../seating/seat-view';
import { CsvRow } from './csv';

export interface Sheet { columns: string[]; rows: CsvRow[] }

/** The same sheet queries serve legacy CSV and a repeatable-read worker capture. */
export class ExportSheets {
  constructor(private readonly prisma: Prisma.TransactionClient, private readonly operations: OperationsService, private readonly locale?: string) {}

  async buildSnapshot(eventId: string, kind: ExportKind): Promise<Sheet> {
    if (kind === 'CATERING_SHEET' || kind === 'BAR_SHEET') {
      const sheet = await venueOperationsSheet(this.prisma, { eventId, kind, locale: this.locale ?? 'hy' });
      if (sheet) return sheet;
    }
    return this.build(eventId, kind);
  }

  /** One builder per kind; adding an export is adding a row. */
  build(eventId: string, kind: ExportKind): Promise<Sheet> {
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
        select: {
          firstName: true, lastName: true, email: true, phone: true, attribution: true,
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
          seats: { include: SEAT_DETAIL },
          checkIn: { select: { arrivedAt: true } },
        },
        orderBy: [{ household: { name: 'asc' } }, { isPrimary: 'desc' }, { firstName: 'asc' }],
      }),
      this.questionColumns(eventId),
    ]);

    return {
      columns: [
        'Household', 'First name', 'Last name', 'Email', 'Phone', 'Side',
        'Seats allotted', 'RSVP', 'Dietary', 'Dietary notes', 'Drink', 'Table', 'Seating by venue', 'Arrived',
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
        Table: singleTable(guest.seats),
        'Seating by venue': guest.seats.map((seat) => `${seat.table.venue?.name ?? 'Unspecified'}: ${seat.table.name}`).sort().join('; '),
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
    const defaultLocale = event?.defaultLocale ?? 'hy';
    const locale = this.locale ?? defaultLocale;

    return (event?.invitation?.questions ?? []).map((question, index) => ({
      ...question,
      // Numbered so two questions with the same wording do not share a column.
      heading: `Q${index + 1}: ${resolveTranslation<string>(question.prompt, locale, defaultLocale) ?? ''}`,
      labels: optionLabels(question.options, locale, defaultLocale),
    }));
  }

  private async seatingChart(eventId: string): Promise<Sheet> {
    const tables = await this.prisma.table.findMany({
      where: { eventId },
      include: {
        venue: { select: { name: true } },
        seats: {
          include: { guest: { select: { firstName: true, lastName: true } } },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      columns: ['Venue', 'Arrangement', 'Table', 'Capacity', 'Seated', 'Guest'],
      rows: tables.flatMap((table): CsvRow[] =>
        // A table with nobody at it still needs a line, or the venue setting
        // out the room will not know it exists.
        table.seats.length === 0
          ? [{ Venue: table.venue?.name ?? 'Unspecified', Arrangement: table.arrangementId, Table: table.name, Capacity: table.capacity, Seated: 0, Guest: null }]
          : table.seats.map((seat) => ({
              Venue: table.venue?.name ?? 'Unspecified',
              Arrangement: table.arrangementId,
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
      select: { firstName: true, lastName: true, seats: { include: SEAT_DETAIL } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return {
      columns: ['Name', 'Venue', 'Arrangement', 'Table'],
      rows: guests.flatMap((guest): CsvRow[] => guest.seats.length === 0
        ? [{ Name: fullName(guest), Venue: null, Arrangement: null, Table: null }]
        : guest.seats.map((seat) => ({
          Name: fullName(guest), Venue: seat.table.venue?.name ?? 'Unspecified', Arrangement: seat.arrangementId, Table: seat.table.name,
        }))),
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
        ticketType: { select: { name: true, event: { select: { defaultLocale: true } } } },
        guest: { select: { firstName: true, lastName: true } },
        order: { select: { buyerName: true, buyerEmail: true } },
      },
      orderBy: { issuedAt: 'asc' },
    });

    return {
      columns: ['Code', 'Type', 'Holder', 'Buyer', 'Buyer email', 'Status', 'Used at'],
      rows: tickets.map((ticket) => ({
        Code: ticket.code,
        Type: this.locale ? resolveTranslation<string>(ticket.ticketType.name, this.locale, ticket.ticketType.event.defaultLocale) : JSON.stringify(ticket.ticketType.name),
        Holder: ticket.guest ? fullName(ticket.guest) : ticket.holderName,
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
