import { BillingInterval } from '@prisma/client';
import { invoiceNumberFor, periodAfter } from './billing-period';

describe('periodAfter', () => {
  const at = (iso: string) => new Date(iso);

  it('adds a month for a monthly plan', () => {
    expect(periodAfter(BillingInterval.MONTHLY, at('2026-03-15T00:00:00.000Z'))).toEqual({
      start: at('2026-03-15T00:00:00.000Z'),
      end: at('2026-04-15T00:00:00.000Z'),
    });
  });

  it('adds a year for a yearly plan', () => {
    expect(periodAfter(BillingInterval.YEARLY, at('2026-03-15T00:00:00.000Z')).end).toEqual(
      at('2027-03-15T00:00:00.000Z'),
    );
  });

  /**
   * The case that breaks naive date maths: there is no 31 February. Rolling
   * over into March would charge a customer eleven times some years and
   * thirteen others.
   */
  it.each([
    { from: '2026-01-31T00:00:00.000Z', end: '2026-02-28T00:00:00.000Z', label: 'January 31 in a common year' },
    { from: '2028-01-31T00:00:00.000Z', end: '2028-02-29T00:00:00.000Z', label: 'January 31 in a leap year' },
    { from: '2026-03-31T00:00:00.000Z', end: '2026-04-30T00:00:00.000Z', label: 'March 31 into a 30-day month' },
    { from: '2026-05-31T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z', label: 'May 31 into a 30-day month' },
  ])('clamps $label to the last day of the month', ({ from, end }) => {
    expect(periodAfter(BillingInterval.MONTHLY, at(from)).end).toEqual(at(end));
  });

  it('keeps February 29 on a yearly plan from becoming March 1', () => {
    expect(periodAfter(BillingInterval.YEARLY, at('2028-02-29T00:00:00.000Z')).end).toEqual(
      at('2029-02-28T00:00:00.000Z'),
    );
  });

  /**
   * A per-event plan has no renewal date. Giving it one would make the
   * renewal sweep charge for a period nobody agreed to, so it gets a period
   * that never lapses and is excluded from renewal by status instead.
   */
  it('gives a per-event plan an open-ended period', () => {
    const period = periodAfter(BillingInterval.PER_EVENT, at('2026-03-15T00:00:00.000Z'));
    expect(period.end.getUTCFullYear()).toBeGreaterThan(9000);
  });

  it('never ends a period before it starts', () => {
    for (const interval of Object.values(BillingInterval)) {
      const period = periodAfter(interval, at('2026-02-28T12:34:56.000Z'));
      expect(period.end.getTime()).toBeGreaterThan(period.start.getTime());
    }
  });
});

describe('invoiceNumberFor', () => {
  it('pads the sequence so numbers sort as text', () => {
    expect(invoiceNumberFor('2026', 1)).toBe('AV-2026-000001');
    expect(invoiceNumberFor('2026', 123_456)).toBe('AV-2026-123456');
  });

  // Running past the padding must widen the number, never truncate it: a
  // reused invoice number is a filed document that points at two sales.
  it('widens rather than truncating beyond the padding', () => {
    expect(invoiceNumberFor('2026', 1_234_567)).toBe('AV-2026-1234567');
  });

  it('sorts in issue order as plain text', () => {
    const numbers = [1, 2, 10, 100, 1_000].map((n) => invoiceNumberFor('2026', n));
    expect([...numbers].sort()).toEqual(numbers);
  });
});
