import { DiscountKind } from '@prisma/client';

/**
 * Whether a promo code applies to an order, and what it is worth.
 *
 * Pure, because every rule here is a business decision that must be testable
 * without a database and must produce the same answer in two places: the
 * "check this code" call a buyer makes before committing, and the redemption
 * inside checkout. A discount computed differently in those two places is a
 * customer who was quoted one price and charged another.
 */
export interface ApplicablePromoCode {
  kind: DiscountKind;
  value: bigint;
  eventId: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  minOrderMinor: bigint | null;
  validFrom: Date | null;
  validUntil: Date | null;
  isActive: boolean;
}

export type PromoEvaluation =
  | { isApplicable: true; discountMinor: bigint }
  | { isApplicable: false; reason: string };

/**
 * Rejection reasons are written to be shown to a buyer. "This code has run
 * out" is actionable; "constraint violation" is not.
 */
export function evaluatePromoCode(
  code: ApplicablePromoCode,
  order: { eventId: string; subtotalMinor: bigint },
  now: Date,
): PromoEvaluation {
  const reason = rejectionFor(code, order, now);
  if (reason) return { isApplicable: false, reason };

  return { isApplicable: true, discountMinor: discountFor(code, order.subtotalMinor) };
}

function rejectionFor(
  code: ApplicablePromoCode,
  order: { eventId: string; subtotalMinor: bigint },
  now: Date,
): string | null {
  // A list rather than a chain of ifs: adding a rule is adding a row, and the
  // first matching rule is the reason the buyer is shown.
  const rules: { isBroken: boolean; reason: string }[] = [
    { isBroken: !code.isActive, reason: 'This code is no longer available' },
    {
      isBroken: code.eventId !== null && code.eventId !== order.eventId,
      reason: 'This code does not apply to this event',
    },
    { isBroken: code.validFrom !== null && now < code.validFrom, reason: 'This code is not valid yet' },
    { isBroken: code.validUntil !== null && now > code.validUntil, reason: 'This code has expired' },
    {
      isBroken: code.maxRedemptions !== null && code.redemptions >= code.maxRedemptions,
      reason: 'This code has run out',
    },
    {
      isBroken: code.minOrderMinor !== null && order.subtotalMinor < code.minOrderMinor,
      reason: `This code needs an order of at least ${code.minOrderMinor?.toString() ?? ''}`,
    },
  ];

  return rules.find((rule) => rule.isBroken)?.reason ?? null;
}

function discountFor(code: ApplicablePromoCode, subtotalMinor: bigint): bigint {
  const raw =
    code.kind === DiscountKind.PERCENT ? (subtotalMinor * code.value) / 100n : code.value;

  return raw > subtotalMinor ? subtotalMinor : raw;
}
