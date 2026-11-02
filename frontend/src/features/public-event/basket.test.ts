import { describe, expect, it } from 'vitest';

import {
  basketParam,
  boundedQuantity,
  isBuyable,
  maxQuantity,
  readBasket,
  ticketCount,
  type SaleLimits,
} from './basket';

function type(id: string, limits: Partial<SaleLimits> = {}): SaleLimits {
  return { id, minPerOrder: 1, maxPerOrder: 10, available: 50, ...limits };
}

const TYPES = [type('general'), type('vip', { minPerOrder: 2, maxPerOrder: 4, available: 3 })];

describe('the basket in the address', () => {
  it("writes the chosen lines in the event's order, leaving out none chosen", () => {
    const basket = [
      { ticketTypeId: 'vip', quantity: 2 },
      { ticketTypeId: 'general', quantity: 0 },
    ];
    expect(basketParam(basket, TYPES)).toBe('vip.2');
    expect(
      basketParam(
        [
          { ticketTypeId: 'vip', quantity: 2 },
          { ticketTypeId: 'general', quantity: 3 },
        ],
        TYPES,
      ),
    ).toBe('general.3,vip.2');
  });

  it('reads back what it wrote', () => {
    expect(readBasket('general.3,vip.2', TYPES)).toEqual([
      { ticketTypeId: 'general', quantity: 3 },
      { ticketTypeId: 'vip', quantity: 2 },
    ]);
  });

  it.each([
    ['unknown.2,general.1', [{ ticketTypeId: 'general', quantity: 1 }]],
    ['general.1,general.5', [{ ticketTypeId: 'general', quantity: 1 }]],
    ['general.x,vip', []],
    ['general.1.5', []],
    ['', []],
    [null, []],
  ])('keeps only what it can read from %j', (param, basket) => {
    expect(readBasket(param, TYPES)).toEqual(basket);
  });

  it('brings each quantity within the minimum, the maximum and what remains', () => {
    expect(readBasket('general.99,vip.1', TYPES)).toEqual([
      { ticketTypeId: 'general', quantity: 10 },
      { ticketTypeId: 'vip', quantity: 2 },
    ]);
  });

  it('leaves out a type of which fewer remain than its minimum', () => {
    const scarce = [type('vip', { minPerOrder: 4, available: 3 })];
    expect(isBuyable(scarce[0]!)).toBe(false);
    expect(readBasket('vip.4', scarce)).toEqual([]);
  });

  it('holds at most ten lines, as one order may', () => {
    const many = Array.from({ length: 12 }, (_, index) => type(`t${index}`));
    const param = many.map((each) => `${each.id}.1`).join(',');
    expect(readBasket(param, many)).toHaveLength(10);
  });

  it('counts the tickets', () => {
    expect(ticketCount(readBasket('general.3,vip.2', TYPES))).toBe(5);
  });
});

describe('a quantity', () => {
  it.each([
    [type('a'), 10],
    [type('a', { available: 4 }), 4],
    [type('a', { maxPerOrder: 100, available: 500 }), 100],
    [type('a', { available: 0 }), 0],
  ])('is at most %o → %i', (limits, most) => {
    expect(maxQuantity(limits)).toBe(most);
  });

  it.each([
    [0, 0],
    [-3, 0],
    [1, 2],
    [3, 3],
    [9, 3],
    [2.5, 2],
  ])('chosen as %d becomes %d for a type of 2 to 4 with 3 left', (chosen, bounded) => {
    expect(boundedQuantity(TYPES[1]!, chosen)).toBe(bounded);
  });
});
