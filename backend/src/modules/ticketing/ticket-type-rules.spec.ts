import { TicketTypeState, canDeleteTicketType, ticketTypeChangeProblems } from './ticket-type-rules';

const state = (overrides: Partial<TicketTypeState> = {}): TicketTypeState => ({
  quantityTotal: 100,
  quantitySold: 30,
  quantityReserved: 5,
  minPerOrder: 1,
  maxPerOrder: 10,
  salesStartAt: null,
  salesEndAt: null,
  ...overrides,
});

describe('ticketTypeChangeProblems', () => {
  it('accepts an unchanged type', () => {
    expect(ticketTypeChangeProblems(state(), {})).toEqual([]);
  });

  /**
   * Decided: price may change at any time. Existing orders captured their
   * unit price when placed, so only future buyers are affected — which is
   * what makes early-bird pricing on one ticket type possible.
   */
  it('allows a price change after tickets have sold', () => {
    expect(ticketTypeChangeProblems(state({ quantitySold: 80 }), { priceMinor: 30_000n })).toEqual(
      [],
    );
  });

  it('refuses a negative price', () => {
    expect(ticketTypeChangeProblems(state(), { priceMinor: -1n })).toHaveLength(1);
  });

  it('allows a free ticket', () => {
    expect(ticketTypeChangeProblems(state(), { priceMinor: 0n })).toEqual([]);
  });

  describe('capacity', () => {
    // 30 sold + 5 held = 35 taken.
    it.each([
      { total: 35, ok: true, label: 'exactly what is taken' },
      { total: 34, ok: false, label: 'one below what is taken' },
      { total: 500, ok: true, label: 'far more' },
    ])('$label ($total)', ({ total, ok }) => {
      expect(ticketTypeChangeProblems(state(), { quantityTotal: total }).length === 0).toBe(ok);
    });

    it('names the floor in the message', () => {
      expect(ticketTypeChangeProblems(state(), { quantityTotal: 10 })[0]).toContain('35');
    });

    it('refuses zero capacity on an unsold type', () => {
      expect(
        ticketTypeChangeProblems(state({ quantitySold: 0, quantityReserved: 0 }), { quantityTotal: 0 }),
      ).toHaveLength(1);
    });
  });

  describe('per-order limits', () => {
    it('refuses a maximum below the minimum', () => {
      expect(ticketTypeChangeProblems(state(), { minPerOrder: 4, maxPerOrder: 2 })).toHaveLength(1);
    });

    // Checked against the stored value when only one side changes.
    it('checks a new minimum against the stored maximum', () => {
      expect(ticketTypeChangeProblems(state({ maxPerOrder: 3 }), { minPerOrder: 5 })).toHaveLength(1);
    });

    it('refuses a minimum of zero', () => {
      expect(ticketTypeChangeProblems(state(), { minPerOrder: 0 })).toHaveLength(1);
    });
  });

  it('refuses a sales window that ends before it starts', () => {
    expect(
      ticketTypeChangeProblems(state(), {
        salesStartAt: new Date('2027-06-02'),
        salesEndAt: new Date('2027-06-01'),
      }),
    ).toHaveLength(1);
  });

  it('reports every problem at once', () => {
    expect(
      ticketTypeChangeProblems(state(), { quantityTotal: 1, minPerOrder: 0, priceMinor: -5n }),
    ).toHaveLength(3);
  });
});

describe('canDeleteTicketType', () => {
  it.each([
    { sold: 0, reserved: 0, can: true },
    { sold: 1, reserved: 0, can: false },
    // A checkout in flight holds seats against it.
    { sold: 0, reserved: 1, can: false },
  ])('sold $sold, reserved $reserved → $can', ({ sold, reserved, can }) => {
    expect(canDeleteTicketType({ quantitySold: sold, quantityReserved: reserved })).toBe(can);
  });
});
