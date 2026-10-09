import { GuestAttribution } from '@prisma/client';

export interface SeatableHousehold {
  householdId: string;
  guestIds: string[];
  /** The side most of this household belongs to, used to group tables. */
  side: GuestAttribution;
  /**
   * Tables where members of this household already sit. When set, those are
   * the only tables it may join: a late acceptor goes beside their family,
   * or stays unseated with a reason — never to another table.
   */
  seatedAt?: string[];
}

export interface SeatableTable {
  tableId: string;
  capacity: number;
  /** Already-seated guests, so a re-run adds to a plan rather than replacing it. */
  occupied: number;
  /** Side already dominant at this table, if any. */
  side: GuestAttribution | null;
}

export interface SeatingPlan {
  assignments: { householdId: string; tableId: string; guestIds: string[] }[];
  /** Households that did not fit anywhere. Reported, never silently dropped. */
  unseated: { householdId: string; size: number; reason: string }[];
}

/**
 * Builds a seating plan.
 *
 * First-fit-decreasing bin packing with a side preference. Largest households
 * are placed first because a table of ten cannot absorb a family of six once
 * four singles have taken seats, and the reverse order strands exactly the
 * groups hardest to place.
 *
 * Two constraints are hard and two are preferences:
 *
 *   hard — a household is never split across tables, including across a
 *          run: members accepting late join the table their family sits at
 *   hard — a table never exceeds its capacity
 *   soft — a household prefers a table already holding its own side
 *   soft — among equals, the emptiest table wins, which spreads guests out
 *          rather than filling tables one at a time
 *
 * Pure, and deliberately so: the interesting part is which household lands
 * where, and that should be testable without a database.
 *
 * First-fit-decreasing is not optimal and is not meant to be. An exact
 * solution is NP-hard, and the product is a good-enough plan a host then
 * adjusts — not a provably optimal one computed in ninety seconds
 * (docs/VENUES_AND_SEATING.md §5). Anything it cannot place is reported with
 * a reason, never dropped.
 *
 * Complexity is O(households × tables). At the scale this product targets —
 * a few hundred households across a few dozen tables — that is tens of
 * thousands of comparisons and runs in single-digit milliseconds, so it is
 * computed in the request. Anything that adds local-improvement passes
 * belongs in a job instead (CLAUDE.md §5).
 */
export function buildSeatingPlan(
  households: SeatableHousehold[],
  tables: SeatableTable[],
): SeatingPlan {
  const remaining = tables.map((table) => ({ ...table }));
  const plan: SeatingPlan = { assignments: [], unseated: [] };

  const largestFirst = [...households].sort(
    (a, b) => b.guestIds.length - a.guestIds.length || a.householdId.localeCompare(b.householdId),
  );

  for (const household of largestFirst) {
    const size = household.guestIds.length;
    if (size === 0) continue;

    const allowed = household.seatedAt?.length ? remaining.filter((t) => household.seatedAt?.includes(t.tableId)) : remaining;
    const table = chooseTable(allowed, household);
    if (!table) {
      plan.unseated.push({
        householdId: household.householdId,
        size,
        reason: household.seatedAt?.length ? whyNotWithFamily(allowed, size) : describeWhyNot(remaining, size),
      });
      continue;
    }

    table.occupied += size;
    table.side ??= household.side;
    plan.assignments.push({
      householdId: household.householdId,
      tableId: table.tableId,
      guestIds: household.guestIds,
    });
  }

  return plan;
}

function chooseTable(
  tables: SeatableTable[],
  household: SeatableHousehold,
): SeatableTable | undefined {
  const roomFor = (table: SeatableTable) => table.capacity - table.occupied;
  const fits = tables.filter((table) => roomFor(table) >= household.guestIds.length);
  if (fits.length === 0) return undefined;

  // A table already seating this side, or not yet committed to one, is
  // preferred — guests of one family end up near each other rather than
  // scattered between two sets of relatives who do not know one another.
  const preferred = fits.filter((table) => table.side === null || table.side === household.side);
  const candidates = preferred.length > 0 ? preferred : fits;

  return candidates.reduce((best, table) =>
    roomFor(table) > roomFor(best) ? table : best,
  );
}

/** Their family's table has no room: the host decides, by moving or enlarging. */
function whyNotWithFamily(tables: SeatableTable[], size: number): string {
  const room = Math.max(0, ...tables.map((table) => table.capacity - table.occupied));
  return `Needs ${size} seat(s) at the table their household already sits at, which has ${room} free`;
}

/** A reason a host can act on, rather than "could not place". */
function describeWhyNot(tables: SeatableTable[], size: number): string {
  if (tables.length === 0) return 'No tables have been created for this event';

  const largestGap = Math.max(...tables.map((table) => table.capacity - table.occupied));
  if (largestGap <= 0) return 'Every table is full';

  return `Needs ${size} adjacent seats; the largest remaining table has ${largestGap}`;
}
