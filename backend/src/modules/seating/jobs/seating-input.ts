import { GuestAttribution, Prisma } from '@prisma/client';
import { SeatableHousehold, SeatableTable } from '../seating-plan';
import { SeatingJobError } from './seating-queue';

export interface SeatingInput {
  households: SeatableHousehold[];
  tables: SeatableTable[];
  availableSeats?: number;
  attendanceRevision: number;
  arrangementRevision: number;
}

/** Snapshot reads select only bounded planner inputs; no locks survive into CPU work. */
export async function loadSeatingInput(tx: Prisma.TransactionClient, eventId: string, arrangementId: string): Promise<SeatingInput> {
  await assertSeatingBounds(tx, eventId, arrangementId);
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { attendanceMode: true, attendanceRevision: true } });
  const arrangement = await tx.seatingArrangement.findUniqueOrThrow({ where: { id: arrangementId }, select: { revision: true, venueId: true, venue: { select: { capacity: true } } } });
  const guests = await tx.guest.findMany({
    where: { eventId, rsvp: { status: 'ATTENDING' }, seats: { none: { arrangementId } },
      ...(event.attendanceMode === 'PER_VENUE' ? { attendanceResponses: { some: { revision: event.attendanceRevision, venueId: arrangement.venueId ?? '__no_venue__', status: 'ATTENDING' } } } : {}),
    }, select: { id: true, householdId: true, attribution: true }, orderBy: { id: 'asc' },
  });
  const tables = await tx.table.findMany({ where: { arrangementId }, select: { id: true, capacity: true,
    seats: { select: { guest: { select: { householdId: true, attribution: true } } } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  const occupied = tables.reduce((sum, table) => sum + table.seats.length, 0);
  return { households: groupHouseholds(guests, tables), tables: tables.map((table) => ({ tableId: table.id, capacity: table.capacity,
    occupied: table.seats.length, side: dominantSide(table.seats.map((seat) => seat.guest.attribution)) })),
    availableSeats: arrangement.venue?.capacity === null || arrangement.venue?.capacity === undefined ? undefined : Math.max(0, arrangement.venue.capacity - occupied),
    attendanceRevision: event.attendanceRevision, arrangementRevision: arrangement.revision };
}

interface GuestInput { id: string; householdId: string; attribution: GuestAttribution | null }
interface TableInput { id: string; seats: { guest: { householdId: string; attribution: GuestAttribution | null } }[] }
function groupHouseholds(guests: GuestInput[], tables: TableInput[]): SeatableHousehold[] {
  const grouped = new Map<string, GuestInput[]>();
  const seatedAt = new Map<string, Set<string>>();
  for (const table of tables) {
    for (const seat of table.seats) {
      const ids = seatedAt.get(seat.guest.householdId) ?? new Set<string>();
      ids.add(table.id); seatedAt.set(seat.guest.householdId, ids);
    }
  }
  for (const guest of guests) { const group = grouped.get(guest.householdId) ?? []; group.push(guest); grouped.set(guest.householdId, group); }
  return [...grouped].map(([householdId, members]) => ({ householdId, guestIds: members.map((guest) => guest.id),
    side: majoritySide(members.map((guest) => guest.attribution ?? 'UNKNOWN')), seatedAt: [...(seatedAt.get(householdId) ?? [])] }));
}
function majoritySide(sides: GuestAttribution[]): GuestAttribution {
  const counts = new Map<GuestAttribution, number>();
  for (const side of sides) counts.set(side, (counts.get(side) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UNKNOWN';
}
function dominantSide(sides: (GuestAttribution | null)[]): GuestAttribution | null {
  const a = sides.filter((side) => side === 'SIDE_A').length;
  const b = sides.filter((side) => side === 'SIDE_B').length;
  if (a === b) return null;
  return a > b ? 'SIDE_A' : 'SIDE_B';
}
export async function assertSeatingBounds(tx: Prisma.TransactionClient, eventId: string, arrangementId: string): Promise<void> {
  const [guests, tables, seats] = await Promise.all([
    tx.guest.count({ where: { eventId } }), tx.table.count({ where: { arrangementId } }), tx.seat.count({ where: { arrangementId } }),
  ]);
  if (guests > 5000 || tables > 500 || seats > 5000) throw new SeatingJobError('INPUT_LIMIT_EXCEEDED', true);
}
