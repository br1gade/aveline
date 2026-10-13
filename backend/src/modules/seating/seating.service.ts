import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GuestAttribution, Prisma, RsvpStatus } from '@prisma/client';
import { isUniqueViolation } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { clearRelease } from './released-seat';
import { assertArrangement, lockArrangement, lockAttendingAnswers, lockGuestAnswer, resolveArrangement } from './seating-arrangements';
import { AssignSeatDto, CreateTableDto, CreateTablesDto, UpdateTableDto } from './dto/seating.dto';
import { SeatableHousehold, SeatableTable, buildSeatingPlan } from './seating-plan';

@Injectable()
export class SeatingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── tables ───────────────────────────────────────────────────────────

  listArrangements(eventId: string) {
    return this.prisma.seatingArrangement.findMany({
      where: { eventId },
      include: { venue: { select: { name: true, capacity: true } }, _count: { select: { tables: true } } },
      orderBy: { id: 'asc' },
    });
  }

  async listTables(eventId: string, arrangementId?: string) {
    await assertArrangement(this.prisma, eventId, arrangementId);
    const tables = await this.prisma.table.findMany({
      where: { eventId, arrangementId },
      include: {
        venue: { select: { name: true } },
        seats: { include: { guest: { select: { id: true, firstName: true, lastName: true } } } },
        seatReleases: {
          include: { guest: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { releasedAt: 'asc' },
        },
      },
      orderBy: [{ arrangementId: 'asc' }, { name: 'asc' }],
    });

    return tables.map((table) => ({
      id: table.id,
      name: table.name,
      capacity: table.capacity,
      zone: table.zone,
      venueId: table.venueId,
      venue: table.venue?.name ?? null,
      arrangementId: table.arrangementId,
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
      // Freed by a decline: the gap, and who left it, until the host acts.
      released: table.seatReleases.map((release) => ({
        guestId: release.guest.id,
        name: [release.guest.firstName, release.guest.lastName].filter(Boolean).join(' '),
        releasedAt: release.releasedAt,
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
    }).catch((error: unknown) => rejectDuplicateName(error, dto.name));
  }

  /** Twenty tables of ten is one request, not twenty. */
  async createTables(eventId: string, dto: CreateTablesDto) {
    return this.prisma.$transaction(async (tx) => {
      await assertVenueOnEvent(tx, eventId, dto.venueId);
      const arrangement = await tx.seatingArrangement.findFirst({ where: { eventId, venueId: dto.venueId ?? null } });
      if (!arrangement) throw new NotFoundException('No such event or venue');
      // Number allocation and insertion share the room lock: concurrent batches cannot disappear as duplicates.
      await lockArrangement(tx, eventId, arrangement.id);
      const taken = await tx.table.findMany({
        where: { arrangementId: arrangement.id, name: { startsWith: `${dto.namePrefix} ` } },
        select: { name: true },
      });
      const highest = Math.max(0, ...taken.map((table) => numberAfter(dto.namePrefix, table.name)));
      const created = await tx.table.createMany({
        data: Array.from({ length: dto.count }, (_, index) => ({
          eventId,
          name: `${dto.namePrefix} ${highest + index + 1}`,
          capacity: dto.capacity,
          zone: dto.zone ?? null,
          venueId: dto.venueId ?? null,
        })),
      });
      return { created: created.count };
    }).catch((error: unknown) => rejectDuplicateName(error, dto.namePrefix));
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
        const current = await lockTable(tx, eventId, tableId);
        await assertTableEdit(tx, current, dto);
        const { seated } = current;
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
    await this.prisma.$transaction(async (tx) => {
      // Locked before counting, for the reason questions are: a guest seated
      // between the count and the delete was cascaded off the plan (B87).
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM tables WHERE id = ${tableId} AND "eventId" = ${eventId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException(`No table ${tableId} on this event`);

      // Deleting would cascade the seats and silently unseat people.
      const seated = await tx.seat.count({ where: { tableId } });
      if (seated > 0) {
        throw new ConflictException(`${seated} guest(s) are seated here; move them before deleting the table`);
      }
      await tx.table.delete({ where: { id: tableId } });
    });
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
      await lockGuestAnswer(tx, eventId, dto.guestId);
      const target = await tx.table.findFirst({ where: { id: dto.tableId, eventId }, select: { arrangementId: true } });
      if (!target) throw new NotFoundException('That table is not on this event');
      const room = await lockArrangement(tx, eventId, target.arrangementId);
      const table = await lockTable(tx, eventId, dto.tableId);
      if (table.arrangementId !== target.arrangementId) throw new ConflictException('The table changed venue; reload the plan');
      const where = { guestId_arrangementId: { guestId: dto.guestId, arrangementId: table.arrangementId } };
      const alreadyHere = await tx.seat.findUnique({ where });
      assertSeatFits(table, room, alreadyHere, dto.position);
      await tx.seat.upsert({
        where,
        create: { guestId: dto.guestId, tableId: dto.tableId, position: dto.position ?? null },
        update: { tableId: dto.tableId, position: dto.position ?? null },
      });
      await clearRelease(tx, [dto.guestId], table.arrangementId);
      return { guestId: dto.guestId, tableId: dto.tableId, table: table.name, arrangementId: table.arrangementId };

    }).catch(rejectOccupiedChair);
  }

  /**
   * Unseats a guest — or, for one whose decline already freed their seat,
   * dismisses the flag that says so.
   */
  async unassign(eventId: string, guestId: string, arrangementId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const arrangement = await resolveArrangement(tx, eventId, arrangementId);
      await lockGuestAnswer(tx, eventId, guestId);
      await lockArrangement(tx, eventId, arrangement.id);
      const removed = await tx.seat.deleteMany({ where: { guestId, arrangementId: arrangement.id, guest: { eventId } } });
      const dismissed = await tx.seatRelease.deleteMany({ where: { guestId, arrangementId: arrangement.id, eventId } });
      if (removed.count === 0 && dismissed.count === 0) throw new NotFoundException('That guest is not seated');
      return { ok: true as const };
    });
  }

  /**
   * Lets guests see their tables, on their own invitation link (decision D4).
   * Changes after publishing show at once — guests read the live plan, not a
   * copy — so a host moving someone the night before needs no second step.
   */
  async publish(eventId: string) {
    return this.setPublished(eventId, new Date());
  }

  /** Takes the tables off guests' pages again, for a plan that is being reworked. */
  async unpublish(eventId: string) {
    return this.setPublished(eventId, null);
  }

  private setPublished(eventId: string, seatingPublishedAt: Date | null) {
    return this.prisma.event.update({
      where: { id: eventId },
      data: { seatingPublishedAt },
      select: { seatingPublishedAt: true },
    });
  }

  /**
   * Seats everyone who has accepted, keeping households together.
   *
   * Additive: guests already placed keep their seats and their tables count
   * as partly occupied, so running this after a late RSVP fills the gaps
   * rather than rearranging a plan a host has already adjusted by hand.
   */
  async autoAssign(eventId: string, arrangementId?: string) {
    const plan = await this.prisma.$transaction(async (tx) => {
      // Every table locked before the room is read: a planner seating someone
      // by hand locks their table too, so they wait for this plan or it waits
      // for them — never both planning from the same empty chair.
      const arrangement = await resolveArrangement(tx, eventId, arrangementId);
      const attending = await lockAttendingAnswers(tx, eventId, arrangement.id);
      const room = await lockArrangement(tx, eventId, arrangement.id);
      await tx.$queryRaw`SELECT id FROM tables WHERE "arrangementId" = ${arrangement.id} ORDER BY id FOR UPDATE`;
      const [households, tables] = await Promise.all([
        loadSeatableHouseholds(tx, eventId, arrangement.id, attending.guestIds),
        loadSeatableTables(tx, arrangement.id),
      ]);
      const available = room.capacity === null ? undefined : Math.max(0, room.capacity - room.occupied);
      const planned = buildSeatingPlan(households, tables, available);
      const seats = planned.assignments.flatMap((assignment) =>
        assignment.guestIds.map((guestId) => ({ guestId, tableId: assignment.tableId })),
      );
      await tx.seat.createMany({ data: seats });
      await clearRelease(tx, seats.map((seat) => seat.guestId), arrangement.id);
      return { ...planned, unseated: [...planned.unseated, ...attending.deferred] };
    });

    return {
      seated: plan.assignments.reduce((sum, a) => sum + a.guestIds.length, 0),
      households: plan.assignments.length,
      unseated: plan.unseated,
    };
  }
}

/**
 * Only households with someone attending and not yet seated — with where the
 * rest of each household already sits, so a late acceptor joins their family.
 */
async function loadSeatableHouseholds(tx: Prisma.TransactionClient, eventId: string, arrangementId: string, attendingIds: string[]): Promise<SeatableHousehold[]> {
  const guests = await tx.guest.findMany({
    where: { eventId, id: { in: attendingIds }, rsvp: { status: RsvpStatus.ATTENDING }, seats: { none: { arrangementId } } },
    select: { id: true, householdId: true, attribution: true },
    orderBy: { householdId: 'asc' },
  });
  const householdIds = [...new Set(guests.map((guest) => guest.householdId))];
  const seated = await tx.seat.findMany({
    where: { arrangementId, guest: { householdId: { in: householdIds } } },
    select: { tableId: true, guest: { select: { householdId: true } } },
  });

  const byHousehold = new Map<string, { guestIds: string[]; sides: GuestAttribution[] }>();
  for (const guest of guests) {
    const entry = byHousehold.get(guest.householdId) ?? { guestIds: [], sides: [] };
    entry.guestIds.push(guest.id);
    entry.sides.push(guest.attribution ?? GuestAttribution.UNKNOWN);
    byHousehold.set(guest.householdId, entry);
  }

  return [...byHousehold.entries()].map(([householdId, entry]) => ({
    householdId,
    guestIds: entry.guestIds,
    side: majoritySide(entry.sides),
    seatedAt: [...new Set(seated.filter((seat) => seat.guest.householdId === householdId).map((seat) => seat.tableId))],
  }));
}

/** The side most of a household belongs to — it was the first guest's. */
function majoritySide(sides: GuestAttribution[]): GuestAttribution {
  const counts = new Map<GuestAttribution, number>();
  for (const side of sides) counts.set(side, (counts.get(side) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? GuestAttribution.UNKNOWN;
}

async function loadSeatableTables(tx: Prisma.TransactionClient, arrangementId: string): Promise<SeatableTable[]> {
  const tables = await tx.table.findMany({
    where: { arrangementId },
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

/** The number in "Table 12" for prefix "Table"; 0 for a name that is not one of the series. */
function numberAfter(prefix: string, name: string): number {
  const suffix = name.slice(prefix.length + 1);
  return /^\d+$/.test(suffix) ? Number(suffix) : 0;
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
  const rows = await tx.$queryRaw<{ id: string; name: string; capacity: number; arrangementId: string; venueId: string | null }[]>`
    SELECT id, name, capacity, "arrangementId", "venueId" FROM tables WHERE id = ${tableId} AND "eventId" = ${eventId} FOR UPDATE`;
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

function rejectDuplicateName(error: unknown, name: string): never {
  if (isUniqueViolation(error)) throw new BadRequestException(`name: there is already a table called "${name}" in this arrangement`);
  throw error;
}

function rejectOccupiedChair(error: unknown): never {
  if (isUniqueViolation(error)) throw new ConflictException('position: that chair is already occupied');
  throw error;
}

async function assertTableEdit(tx: Prisma.TransactionClient, table: Awaited<ReturnType<typeof lockTable>>, dto: UpdateTableDto) {
  if (dto.venueId !== undefined && dto.venueId !== table.venueId) {
    const releases = await tx.seatRelease.count({ where: { tableId: table.id } });
    if (table.seated > 0 || releases > 0) throw new ConflictException('venueId: move guests and dismiss release markers before changing venue');
  }
  if (dto.capacity !== undefined) {
    const outside = await tx.seat.count({ where: { tableId: table.id, position: { gt: dto.capacity } } });
    if (outside > 0) throw new BadRequestException('capacity: move chairs outside the proposed capacity first');
  }
}

function assertSeatFits(
  table: Awaited<ReturnType<typeof lockTable>>,
  room: Awaited<ReturnType<typeof lockArrangement>>,
  existing: { tableId: string } | null,
  position: number | undefined,
) {
  if (existing?.tableId !== table.id && table.seated >= table.capacity) throw new ConflictException(`${table.name} is full`);
  if (!existing && room.capacity !== null && room.occupied >= room.capacity) throw new ConflictException('Venue capacity is full');
  if (position !== undefined && position > table.capacity) throw new BadRequestException('position: outside table capacity');
}
