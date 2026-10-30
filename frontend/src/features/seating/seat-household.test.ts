import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';

import { seatOneByOne } from './seat-household';

describe('seating a household one guest at a time (the FR-53 stand-in)', () => {
  it('sends each guest once, in order, and reports them all seated', async () => {
    const seat = vi.fn((_guestId: string) => Promise.resolve());
    await expect(seatOneByOne(['g1', 'g2', 'g3'], seat)).resolves.toEqual({
      seated: ['g1', 'g2', 'g3'],
      notSeated: [],
      error: null,
    });
    expect(seat.mock.calls.map(([guestId]) => guestId)).toEqual(['g1', 'g2', 'g3']);
  });

  it('stops at the first refusal, and says who was seated and who was not', async () => {
    const full = new ApiError({ status: 409, messages: ['Table 4 is full'] });
    const seat = vi.fn((guestId: string) =>
      guestId === 'g2' ? Promise.reject(full) : Promise.resolve(),
    );
    await expect(seatOneByOne(['g1', 'g2', 'g3'], seat)).resolves.toEqual({
      seated: ['g1'],
      notSeated: ['g2', 'g3'],
      error: full,
    });
    expect(seat).toHaveBeenCalledTimes(2);
  });

  it('sends nothing for nobody', async () => {
    const seat = vi.fn(() => Promise.resolve());
    await expect(seatOneByOne([], seat)).resolves.toEqual({
      seated: [],
      notSeated: [],
      error: null,
    });
    expect(seat).not.toHaveBeenCalled();
  });
});
