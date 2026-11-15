// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { seatRows } from './seat-rows';

const seat = (row: string, label: string) => ({ id: `${row}-${label}`, row, label });

describe('the free seats by row (design PD-201)', () => {
  it('keeps the layout’s order of rows and seats, never sorting them', () => {
    expect(seatRows([seat('C', '2'), seat('C', '10'), seat('A', '1'), seat('C', '1')])).toEqual([
      { row: 'C', seats: [seat('C', '2'), seat('C', '10'), seat('C', '1')] },
      { row: 'A', seats: [seat('A', '1')] },
    ]);
  });

  it('has no rows when no seat is free', () => {
    expect(seatRows([])).toEqual([]);
  });
});
