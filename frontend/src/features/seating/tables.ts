import type { Arrangement, SeatingTable } from './types';

/**
 * Tables by their numbers, "Table 2" before "Table 10". The API orders them by name as text
 * (`seating.service.ts`, `listTables`), so a room of twenty reads 1, 10, 11… **A temporary
 * stand-in** under FR-54. The app's pages render in the browser only, so the server's collation
 * never meets it.
 */
export function inNaturalOrder(tables: readonly SeatingTable[], language: string): SeatingTable[] {
  const collator = new Intl.Collator(language, { numeric: true, sensitivity: 'base' });
  return [...tables].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

/** One plan's tables, in their natural order. */
export function tablesOf(
  tables: readonly SeatingTable[],
  arrangementId: string,
  language: string,
): SeatingTable[] {
  return inNaturalOrder(
    tables.filter((table) => table.arrangementId === arrangementId),
    language,
  );
}

export function freeSeats(table: SeatingTable): number {
  return Math.max(0, table.capacity - table.guests.length);
}

/** Seats left at the venue, when it has a capacity; `null` when it has none. */
export function venueRoom(plan: Arrangement, tables: readonly SeatingTable[]): number | null {
  if (plan.venueCapacity === null) return null;
  const seated = tables.reduce((sum, table) => sum + table.guests.length, 0);
  return Math.max(0, plan.venueCapacity - seated);
}

/**
 * The tables with room for `count` people together, in their order. The venue's own limit counts
 * too: the backend refuses a seat past it as it does one past a table's (docs/API.md §6).
 */
export function roomFor(
  tables: readonly SeatingTable[],
  count: number,
  room: number | null,
): SeatingTable[] {
  if (room !== null && room < count) return [];
  return tables.filter((table) => freeSeats(table) >= count);
}
