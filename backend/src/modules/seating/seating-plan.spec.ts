import { GuestAttribution } from '@prisma/client';
import { SeatableHousehold, SeatableTable, buildSeatingPlan } from './seating-plan';

/**
 * Seating is the one place where a plausible-looking result can be wrong in a
 * way nobody notices until four hundred people are standing in a room. These
 * tests pin the constraints that must hold, not the particular arrangement.
 */
describe('buildSeatingPlan', () => {
  const household = (
    id: string,
    size: number,
    side: GuestAttribution = GuestAttribution.SIDE_A,
  ): SeatableHousehold => ({
    householdId: id,
    guestIds: Array.from({ length: size }, (_, i) => `${id}-g${i}`),
    side,
  });

  const table = (id: string, capacity: number, occupied = 0, side: GuestAttribution | null = null): SeatableTable => ({
    tableId: id,
    capacity,
    occupied,
    side,
  });

  const seatedCount = (plan: ReturnType<typeof buildSeatingPlan>) =>
    plan.assignments.reduce((sum, a) => sum + a.guestIds.length, 0);

  describe('hard constraints', () => {
    it('never exceeds a table’s capacity', () => {
      const plan = buildSeatingPlan(
        [household('h1', 4), household('h2', 4), household('h3', 4)],
        [table('t1', 10), table('t2', 10)],
      );

      const perTable = new Map<string, number>();
      for (const a of plan.assignments) {
        perTable.set(a.tableId, (perTable.get(a.tableId) ?? 0) + a.guestIds.length);
      }
      for (const [, seated] of perTable) expect(seated).toBeLessThanOrEqual(10);
    });

    it('never splits a household across tables', () => {
      const plan = buildSeatingPlan([household('h1', 6)], [table('t1', 4), table('t2', 8)]);

      expect(plan.assignments).toHaveLength(1);
      expect(plan.assignments[0].guestIds).toHaveLength(6);
      expect(plan.assignments[0].tableId).toBe('t2');
    });

    it('respects seats already taken', () => {
      const plan = buildSeatingPlan([household('h1', 5)], [table('t1', 10, 8)]);

      expect(plan.assignments).toHaveLength(0);
      expect(plan.unseated[0].reason).toContain('2');
    });
  });

  describe('placement order', () => {
    // Placing small groups first strands the large ones, which are exactly
    // the hardest to place.
    it('seats the largest household first, so big families still fit', () => {
      const plan = buildSeatingPlan(
        [household('small-a', 1), household('small-b', 1), household('big', 8)],
        [table('t1', 8), table('t2', 2)],
      );

      expect(plan.unseated).toHaveLength(0);
      const big = plan.assignments.find((a) => a.householdId === 'big');
      expect(big?.tableId).toBe('t1');
    });
  });

  describe('side preference', () => {
    it('prefers a table already seating the same side', () => {
      const plan = buildSeatingPlan(
        [household('h1', 2, GuestAttribution.SIDE_B)],
        [table('t1', 10, 2, GuestAttribution.SIDE_A), table('t2', 10, 4, GuestAttribution.SIDE_B)],
      );

      expect(plan.assignments[0].tableId).toBe('t2');
    });

    it('seats across sides rather than leaving someone standing', () => {
      const plan = buildSeatingPlan(
        [household('h1', 4, GuestAttribution.SIDE_B)],
        [table('t1', 4, 0, GuestAttribution.SIDE_A)],
      );

      expect(plan.assignments).toHaveLength(1);
      expect(plan.unseated).toHaveLength(0);
    });
  });

  describe('what cannot be seated', () => {
    it('reports an oversized household rather than dropping it', () => {
      const plan = buildSeatingPlan([household('huge', 12)], [table('t1', 10)]);

      expect(plan.assignments).toHaveLength(0);
      expect(plan.unseated).toEqual([
        { householdId: 'huge', size: 12, reason: expect.stringContaining('10') },
      ]);
    });

    it('says so plainly when no tables exist', () => {
      const plan = buildSeatingPlan([household('h1', 2)], []);
      expect(plan.unseated[0].reason).toMatch(/No tables/);
    });

    it('says so plainly when every table is full', () => {
      const plan = buildSeatingPlan([household('h1', 1)], [table('t1', 4, 4)]);
      expect(plan.unseated[0].reason).toMatch(/full/);
    });
  });

  describe('scale', () => {
    // The shape this product actually targets.
    it('seats 400 guests across 40 tables, within a request budget', () => {
      const households = Array.from({ length: 160 }, (_, i) =>
        household(`h${i}`, (i % 4) + 1, i % 2 ? GuestAttribution.SIDE_A : GuestAttribution.SIDE_B),
      );
      const tables = Array.from({ length: 40 }, (_, i) => table(`t${i}`, 10));

      const startedAt = Date.now();
      const plan = buildSeatingPlan(households, tables);
      const elapsed = Date.now() - startedAt;

      expect(seatedCount(plan) + plan.unseated.reduce((s, u) => s + u.size, 0)).toBe(
        households.reduce((s, h) => s + h.guestIds.length, 0),
      );
      expect(elapsed).toBeLessThan(100);
    });

    it('is deterministic — the same input gives the same plan', () => {
      const households = [household('a', 3), household('b', 3), household('c', 2)];
      const tables = [table('t1', 5), table('t2', 5)];

      expect(buildSeatingPlan(households, tables)).toEqual(buildSeatingPlan(households, tables));
    });

    it('seats everyone when the capacity divides exactly', () => {
      const plan = buildSeatingPlan(
        [household('h1', 3), household('h2', 3), household('h3', 2), household('h4', 2)],
        [table('t1', 5), table('t2', 5)],
      );

      expect(plan.unseated).toHaveLength(0);
      expect(seatedCount(plan)).toBe(10);
    });

    /**
     * First-fit-decreasing is not optimal, and this records where it gives up
     * so the limit is a known one rather than a surprise.
     *
     * Households of 3 and 3 into tables of 4 and 4 has no valid packing at
     * all — neither table holds six and splitting a household is forbidden —
     * so being unable to seat both is correct. What matters is that the
     * second is reported rather than dropped.
     */
    it('reports what it cannot pack instead of silently losing it', () => {
      const plan = buildSeatingPlan(
        [household('h1', 3), household('h2', 3)],
        [table('t1', 4), table('t2', 2)],
      );

      expect(plan.assignments).toHaveLength(1);
      expect(plan.unseated).toHaveLength(1);
      expect(seatedCount(plan) + plan.unseated[0].size).toBe(6);
    });
  });

  // B66: a late acceptor whose family was already seated went to an empty
  // table — the household split, which the planner calls a hard constraint.
  describe('a household partly seated already', () => {
    it('joins the table its family sits at, not the emptiest', () => {
      const plan = buildSeatingPlan(
        [{ ...household('h1', 1), seatedAt: ['t1'] }],
        [table('t1', 10, 2), table('t2', 10, 0)],
      );

      expect(plan.assignments).toEqual([expect.objectContaining({ householdId: 'h1', tableId: 't1' })]);
    });

    it('stays unseated, with a reason, rather than split when that table is full', () => {
      const plan = buildSeatingPlan(
        [{ ...household('h1', 1), seatedAt: ['t1'] }],
        [table('t1', 2, 2), table('t2', 10, 0)],
      );

      expect(plan.assignments).toEqual([]);
      expect(plan.unseated[0]).toMatchObject({ householdId: 'h1', reason: expect.stringMatching(/already sits/) });
    });
  });
});
