import type { AttendanceMode } from '@/features/events';
import type { Guest, Household } from '@/features/guests';

import type { Arrangement, SeatingTable } from './types';

export interface PersonToSeat {
  id: string;
  name: string;
}

/** A household with the people coming here who have no seat in this plan yet (design PD-69). */
export interface HouseholdToSeat {
  id: string;
  name: string;
  guests: PersonToSeat[];
  /** Tables in this plan where any of its members already sits, so it stays together. */
  homeTableIds: string[];
}

/**
 * Coming here, as automatic seating reads it (`seating-input.ts`): the answer for the event, or in
 * PER_VENUE the answer for this venue. The plan without a venue has nobody coming in PER_VENUE.
 */
export function isComing(guest: Guest, plan: Arrangement, mode: AttendanceMode): boolean {
  if (mode === 'EVENT_WIDE') return guest.answer === 'ATTENDING';
  if (plan.venueId === null) return false;
  return guest.venueAnswers.some(
    (answer) => answer.venueId === plan.venueId && answer.answer === 'ATTENDING',
  );
}

/** Who sits in this plan, held seats included, and at which table. */
function tableOfEach(tables: readonly SeatingTable[], plan: Arrangement): Map<string, string> {
  const seated = new Map<string, string>();
  for (const table of tables) {
    if (table.arrangementId !== plan.id) continue;
    for (const guest of table.guests) seated.set(guest.guestId, table.id);
  }
  return seated;
}

/** In the plan's own table order, each once. */
function homeTablesOf(
  household: Household,
  seated: ReadonlyMap<string, string>,
  tables: readonly SeatingTable[],
): string[] {
  const ids = new Set(household.guests.flatMap((guest) => seated.get(guest.id) ?? []));
  return tables.filter((table) => ids.has(table.id)).map((table) => table.id);
}

/**
 * The households still to seat in this plan, in the guest list's order, each with only its members
 * who are coming here and have no seat here. Someone seated at another venue's plan is still offered.
 */
export function householdsToSeat(
  households: readonly Household[],
  plan: Arrangement,
  mode: AttendanceMode,
  tables: readonly SeatingTable[],
): HouseholdToSeat[] {
  const seated = tableOfEach(tables, plan);
  return households.flatMap((household) => {
    const guests = household.guests
      .filter((guest) => isComing(guest, plan, mode) && !seated.has(guest.id))
      .map(({ id, name }) => ({ id, name }));
    if (guests.length === 0) return [];
    const homeTableIds = homeTablesOf(household, seated, tables);
    return [{ id: household.id, name: household.name, guests, homeTableIds }];
  });
}
