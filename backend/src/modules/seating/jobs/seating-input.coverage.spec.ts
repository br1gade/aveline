import { Prisma } from '@prisma/client';
import { assertSeatingBounds } from './seating-input';
import { SeatingJobError } from './seating-queue';

/**
 * docs/API.md: automatic planning supports at most 5,000 arrangement seats.
 * Seats are unique per guest and arrangement and every seat belongs to a guest
 * of the event, so a real database reaches the guest bound first; only counts
 * the database cannot produce show the seat check on its own.
 */
describe('Automatic seating input bounds', () => {
  const transaction = (seats: number) => {
    const seatCount = jest.fn().mockResolvedValue(seats);
    const tx = {
      guest: { count: jest.fn().mockResolvedValue(10) },
      table: { count: jest.fn().mockResolvedValue(1) },
      seat: { count: seatCount },
    } as unknown as Prisma.TransactionClient;
    return { tx, seatCount };
  };

  it('accepts an arrangement of exactly 5,000 seats', async () => {
    const { tx } = transaction(5000);

    await expect(assertSeatingBounds(tx, 'event', 'arrangement')).resolves.toBeUndefined();
  });

  it('refuses an arrangement of 5,001 seats as a permanent INPUT_LIMIT_EXCEEDED', async () => {
    const { tx } = transaction(5001);

    const refusal = await assertSeatingBounds(tx, 'event', 'arrangement').then(() => null, (error: unknown) => error);

    expect(refusal).toBeInstanceOf(SeatingJobError);
    expect(refusal).toMatchObject({ code: 'INPUT_LIMIT_EXCEEDED', isPermanent: true });
  });

  it('counts seats in the planned arrangement only, not across the event', async () => {
    const { tx, seatCount } = transaction(0);

    await assertSeatingBounds(tx, 'event', 'arrangement');

    expect(seatCount).toHaveBeenCalledWith({ where: { arrangementId: 'arrangement' } });
  });
});
