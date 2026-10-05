import { BillingInterval } from '@prisma/client';

export interface BillingPeriod { start: Date; end: Date }

/**
 * A per-event plan is not charged on a schedule, so it is given a period that
 * never lapses rather than a null the renewal sweep would have to special-case.
 */
const NEVER = new Date('9999-12-31T00:00:00.000Z');

/** The period that begins at `from` under this plan's interval. */
export function periodAfter(interval: BillingInterval, from: Date): BillingPeriod {
  const monthsToAdd = MONTHS_PER_INTERVAL[interval];
  return {
    start: from,
    end: monthsToAdd === null ? NEVER : addMonths(from, monthsToAdd),
  };
}

const MONTHS_PER_INTERVAL: Record<BillingInterval, number | null> = {
  [BillingInterval.MONTHLY]: 1,
  [BillingInterval.YEARLY]: 12,
  [BillingInterval.PER_EVENT]: null,
};

/**
 * Adds months, clamping the day to the target month's length.
 *
 * `Date.setUTCMonth` rolls 31 January forward into 3 March, which would charge
 * a monthly subscriber thirteen times in some years. Clamping to 28 February
 * keeps one charge per month and keeps the anniversary stable.
 */
function addMonths(from: Date, months: number): Date {
  const target = new Date(from);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();

  target.setUTCDate(Math.min(from.getUTCDate(), lastDayOfTargetMonth));
  return target;
}

/** Zero-padded so a plain text sort is also issue order. */
export function invoiceNumberFor(series: string, sequence: number): string {
  return `AV-${series}-${String(sequence).padStart(6, '0')}`;
}
