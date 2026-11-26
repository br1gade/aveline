import { BillingInterval } from '@prisma/client';
import { periodAfter } from './billing-period';

export function renewalPeriod(terms: { interval: BillingInterval; end: Date; anchor: Date }, now: Date) {
  if (now > terms.end) return periodAfter(terms.interval, now);
  const period = periodAfter(terms.interval, terms.end);
  const end = new Date(period.end);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(terms.anchor.getUTCDate(), last));
  return { start: terms.end, end };
}
