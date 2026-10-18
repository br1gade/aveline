import { SeatableHousehold, SeatingPlan } from '../seating-plan';
import { SeatingInput } from './seating-input';
import { SeatingJobError } from './seating-queue';

/** Revalidate complete households and current capacities before a bulk insert. */
export function assertPlanFits(input: SeatingInput, plan: SeatingPlan): void {
  const households = new Map(input.households.map((household) => [household.householdId, household]));
  const tables = new Map(input.tables.map((table) => [table.tableId, { ...table }]));
  const assigned = new Set<string>();
  let total = 0;
  for (const assignment of plan.assignments) {
    const household = households.get(assignment.householdId);
    const table = tables.get(assignment.tableId);
    if (!household || !table || assigned.has(household.householdId)) throw new SeatingJobError('INVALID_PLAN');
    const ids = assertHousehold(assignment, household);
    assigned.add(household.householdId);
    table.occupied += ids.size;
    total += ids.size;
    if (table.occupied > table.capacity) throw new SeatingJobError('INVALID_PLAN');
  }
  if (total > (input.availableSeats ?? Infinity)) throw new SeatingJobError('INVALID_PLAN');
}

function assertHousehold(assignment: SeatingPlan['assignments'][number], household: SeatableHousehold): Set<string> {
  const ids = new Set(assignment.guestIds);
  if (ids.size !== assignment.guestIds.length || ids.size !== household.guestIds.length || !household.guestIds.every((id) => ids.has(id))) throw new SeatingJobError('INVALID_PLAN');
  if (household.seatedAt?.length && !household.seatedAt.includes(assignment.tableId)) throw new SeatingJobError('INVALID_PLAN');
  return ids;
}
