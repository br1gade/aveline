import { GuestAttribution } from '@prisma/client';
import { buildSeatingPlan } from './seating-plan';

describe('Venue capacity across tables', () => {
  it.each([0, 1, 2])('seats at most %i additional people even when tables have more space', (available) => {
    const households = ['A', 'B', 'C'].map((id) => ({ householdId: id, guestIds: [id], side: GuestAttribution.UNKNOWN }));
    const tables = [{ tableId: 'large', capacity: 10, occupied: 0, side: null }];
    const plan = buildSeatingPlan(households, tables, available);
    expect(plan.assignments.flatMap((assignment) => assignment.guestIds)).toHaveLength(available);
    expect(plan.unseated).toHaveLength(3 - available);
    expect(plan.unseated.every((entry) => entry.reason.includes('venue'))).toBe(true);
  });

  it('does not split a family to fill a venue’s last chair', () => {
    const plan = buildSeatingPlan([
      { householdId: 'family', guestIds: ['A', 'B'], side: GuestAttribution.UNKNOWN },
      { householdId: 'single', guestIds: ['C'], side: GuestAttribution.UNKNOWN },
    ], [{ tableId: 'large', capacity: 10, occupied: 0, side: null }], 1);
    expect(plan.assignments.flatMap((assignment) => assignment.guestIds)).toEqual(['C']);
    expect(plan.unseated).toEqual([{ householdId: 'family', size: 2, reason: expect.stringContaining('venue') }]);
  });
});
