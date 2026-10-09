import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GuestAttribution, Prisma, RsvpStatus } from '@prisma/client';
import { isUniqueViolation } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignSeatDto, CreateTableDto, CreateTablesDto, UpdateTableDto } from './dto/seating.dto';
import { SeatableHousehold, SeatableTable, buildSeatingPlan } from './seating-plan';

@Injectable()
export class SeatingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── tables ───────────────────────────────────────────────────────────

  async listTables(eventId: string) {
    const tables = await this.prisma.table.findMany({
      where: { eventId },
      include: {
        seats: { include: { guest: { select: { id: true, firstName: true, lastName: true } } } },
      },
      orderBy: { name: 'asc' },
    });

    return tables.map((table) => ({
      id: table.id,
      name: table.name,
      capacity: table.capacity,
      zone: table.zone,
      venueId: table.venueId,
      posX: table.posX,
      posY: table.posY,
      shape: table.shape,
      seated: table.seats.length,
      available: table.capacity - table.seats.length,
      guests: table.seats.map((seat) => ({
        guestId: seat.guest.id,
        name: [seat.guest.firstName, seat.guest.lastName].filter(Boolean).join(' '),
        position: seat.position,
      })),
    }));
  }

  async createTable(eventId: string, dto: CreateTableDto) {
    await assertVenueOnEvent(this.prisma, eventId, dto.venueId);
    return this.prisma.table.create({
      data: {
        eventId,
        name: dto.name,
        capacity: dto.capacity,
        zone: dto.zone ?? null,
        venueId: dto.venueId ?? null,
      },
    });
  }

  /** Twenty tables of ten is one request, not twenty. */
  async createTables(eventId: string, dto: CreateTablesDto) {
    await assertVenueOnEvent(this.prisma, eventId, dto.venueId);
    const existing = await this.prisma.table.count({ where: { eventId } });

    const created = await this.prisma.table.createMany({
      data: Array.from({ length: dto.count }, (_, index) => ({
        eventId,
        name: `${dto.namePrefix} ${existing + index + 1}`,
        capacity: dto.capacity,
        zone: dto.zone ?? null,
        venueId: dto.venueId ?? null,
      })),
      skipDuplicates: true,
    });

    return { created: created.count };
  }

  /**
   * Changes a table: name, size, venue, and where it sits on the plan.
   *
   * Never below the guests already seated — shrinking would leave people in
   * chairs that no longer exist. The table is locked while it is checked, so
   * a guest seated at the same moment is counted.
   */
  async updateTable(eventId: string, tableId: string, dto: UpdateTableDto) {
    await assertVenueOnEvent(this.prisma, eventId, dto.venueId);

    return this.prisma
      .$transaction(async (tx) => {
        const { seated } = await lockTable(tx, eventId, tableId);
        if (dto.capacity !== undefined && dto.capacity < seated) {
          throw new BadRequestException(`capacity: ${seated} guest(s) are seated here; move some first`);
        }

        return tx.table.update({
          where: { id: tableId },
          data: {
            name: dto.name?.trim(),
            capacity: dto.capacity,
            zone: dto.zone,
            venueId: dto.venueId,
            posX: dto.posX,
            posY: dto.posY,
            shape: dto.shape,
          },
        });
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new BadRequestException(`name: there is already a table called "${dto.name}"`);
        throw error;
      });
  }

  async deleteTable(eventId: string, tableId: string) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, eventId },
      include: { _count: { select: { seats: true } } },
    });
    if (!table) throw new NotFoundException(`No table ${tableId} on this event`);

    // Deleting would cascade the seats and silently unseat people.
    if (table._count.seats > 0) {
      throw new ConflictException(
        `${table._count.seats} guest(s) are seated here; move them before deleting the table`,
      );
    }

    await this.prisma.table.delete({ where: { id: tableId } });
    return { ok: true as const };
  }

  // ── assignment ───────────────────────────────────────────────────────

  /**
   * Seats one guest, moving them if they were already placed.
   *
   * Capacity is checked inside the transaction and re-read there, so two
   * coordinators seating the last chair at once cannot both succeed.
   */
  async assign(eventId: string, dto: AssignSeatDto) {
    return this.prisma.$transaction(async (tx) => {
      const guest = await tx.guest.findFirst({ where: { id: dto.guestId, eventId } });
      if (!guest) throw new NotFoundException('That guest is not on this event');
      // Locked, not just read: two planners seating the last chair at once
      // both counted one free seat and both sat someone down.
      const table = await lockTable(tx, eventId, dto.tableId);

      const alreadyHere = await tx.seat.findUnique({ where: { guestId: dto.guestId } });
      const isMoveWithinTable = alreadyHere?.tableId === dto.tableId;

      if (!isMoveWithinTable && table.seated >= table.capacity) {
        throw new ConflictException(`${table.name} is full`);
      }

      await tx.seat.upsert({
        where: { guestId: dto.guestId },
        create: { guestId: dto.guestId, tableId: dto.tableId, position: dto.position ?? null },
        update: { tableId: dto.tableId, position: dto.position ?? null },
      });

      return { guestId: dto.guestId, tableId: dto.tableId, table: table.name };
    });
  }

  async unassign(eventId: string, guestId: string) {
    const removed = await this.prisma.seat.deleteMany({
      where: { guestId, guest: { eventId } },
    });
    if (removed.count === 0) throw new NotFoundException('That guest is not seated');
    return { ok: true as const };
  }

  /**
   * Seats everyone who has accepted, keeping households together.
   *
   * Additive: guests already placed keep their seats and their tables count
   * as partly occupied, so running this after a late RSVP fills the gaps
   * rather than rearranging a plan a host has already adjusted by hand.
   */
  async autoAssign(eventId: string) {
    const [households, tables] = await Promise.all([
      this.loadSeatableHouseholds(eventId),
      this.loadSeatableTables(eventId),
    ]);

    const plan = buildSeatingPlan(households, tables);

    await this.prisma.$transaction(
      plan.assignments.flatMap((assignment) =>
        assignment.guestIds.map((guestId) =>
          this.prisma.seat.upsert({
            where: { guestId },
            create: { guestId, tableId: assignment.tableId },
            update: { tableId: assignment.tableId },
          }),
        ),
      ),
    );

    return {
      seated: plan.assignments.reduce((sum, a) => sum + a.guestIds.length, 0),
      households: plan.assignments.length,
      unseated: plan.unseated,
    };
  }

  /** Only households with someone attending and not yet seated. */
  private async loadSeatableHouseholds(eventId: string): Promise<SeatableHousehold[]> {
    const guests = await this.prisma.guest.findMany({
      where: { eventId, rsvp: { status: RsvpStatus.ATTENDING }, seat: null },
      select: { id: true, householdId: true, attribution: true },
      orderBy: { householdId: 'asc' },
    });

    const byHousehold = new Map<string, SeatableHousehold>();
    for (const guest of guests) {
      const existing = byHousehold.get(guest.householdId);
      if (existing) {
        existing.guestIds.push(guest.id);
        continue;
      }
      byHousehold.set(guest.householdId, {
        householdId: guest.householdId,
        guestIds: [guest.id],
        side: guest.attribution ?? GuestAttribution.UNKNOWN,
      });
    }

    return [...byHousehold.values()];
  }

  private async loadSeatableTables(eventId: string): Promise<SeatableTable[]> {
    const tables = await this.prisma.table.findMany({
      where: { eventId },
      include: { seats: { include: { guest: { select: { attribution: true } } } } },
      orderBy: { name: 'asc' },
    });

    return tables.map((table) => ({
      tableId: table.id,
      capacity: table.capacity,
      occupied: table.seats.length,
      side: dominantSide(table.seats.map((seat) => seat.guest.attribution)),
    }));
  }
}

/** Which side a table already belongs to, if any clearly does. */
function dominantSide(attributions: GuestAttribution[]): GuestAttribution | null {
  const sides = attributions.filter(
    (side) => side === GuestAttribution.SIDE_A || side === GuestAttribution.SIDE_B,
  );
  if (sides.length === 0) return null;

  const a = sides.filter((side) => side === GuestAttribution.SIDE_A).length;
  if (a === sides.length - a) return null;
  return a > sides.length - a ? GuestAttribution.SIDE_A : GuestAttribution.SIDE_B;
}

/** One table, locked for the rest of the transaction, with how many sit at it. */
async function lockTable(tx: Prisma.TransactionClient, eventId: string, tableId: string) {
  const rows = await tx.$queryRaw<{ id: string; name: string; capacity: number }[]>`
    SELECT id, name, capacity FROM tables WHERE id = ${tableId} AND "eventId" = ${eventId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException('That table is not on this event');

  const seated = await tx.seat.count({ where: { tableId } });
  return { ...rows[0], seated };
}

/**
 * A table may only stand in this event's own venue. One pointing at another
 * event's venue also stopped that event deleting its venue.
 */
async function assertVenueOnEvent(
  prisma: Pick<Prisma.TransactionClient, 'venue'>,
  eventId: string,
  venueId: string | null | undefined,
): Promise<void> {
  if (!venueId) return;
  const venue = await prisma.venue.findFirst({ where: { id: venueId, eventId }, select: { id: true } });
  if (!venue) throw new BadRequestException(`venueId: ${venueId} is not one of this event's venues`);
}
