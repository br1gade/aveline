import { DiscountKind } from '@prisma/client';
import { ApplicablePromoCode, evaluatePromoCode } from './promo-code';

/**
 * Domain sets here are the validity boundaries: a code is tested on the day it
 * starts, the day it ends, at its redemption limit and at its minimum order —
 * not at one comfortable value in the middle.
 */
describe('evaluatePromoCode', () => {
  const NOW = new Date('2026-06-15T12:00:00.000Z');
  const EVENT = 'event-1';

  const promo = (overrides: Partial<ApplicablePromoCode> = {}): ApplicablePromoCode => ({
    kind: DiscountKind.PERCENT,
    value: 10n,
    eventId: null,
    maxRedemptions: null,
    redemptions: 0,
    minOrderMinor: null,
    validFrom: null,
    validUntil: null,
    isActive: true,
    ...overrides,
  });

  const evaluate = (code: ApplicablePromoCode, subtotalMinor: bigint) =>
    evaluatePromoCode(code, { eventId: EVENT, subtotalMinor }, NOW);

  describe('what a code is worth', () => {
    it('takes a percentage of the order', () => {
      expect(evaluate(promo({ value: 10n }), 25_000n)).toEqual({
        isApplicable: true,
        discountMinor: 2_500n,
      });
    });

    it('takes a fixed amount in minor units', () => {
      expect(evaluate(promo({ kind: DiscountKind.FIXED, value: 5_000n }), 25_000n)).toEqual({
        isApplicable: true,
        discountMinor: 5_000n,
      });
    });

    // A negative total would look like a refund the bank never made.
    it.each([
      { kind: DiscountKind.FIXED, value: 30_000n, label: 'a fixed amount over the total' },
      { kind: DiscountKind.PERCENT, value: 100n, label: 'a hundred percent' },
    ])('caps $label at the order total', ({ kind, value }) => {
      expect(evaluate(promo({ kind, value }), 25_000n)).toEqual({
        isApplicable: true,
        discountMinor: 25_000n,
      });
    });

    // AMD has no subunit, so the rounding error is at most one dram, and it
    // goes to the customer.
    it('rounds a percentage down', () => {
      expect(evaluate(promo({ value: 33n }), 100n)).toEqual({
        isApplicable: true,
        discountMinor: 33n,
      });
    });

    it('allows a free order to stay free', () => {
      expect(evaluate(promo({ kind: DiscountKind.FIXED, value: 5_000n }), 0n)).toEqual({
        isApplicable: true,
        discountMinor: 0n,
      });
    });
  });

  describe('when a code does not apply', () => {
    it('rejects an inactive code', () => {
      expect(evaluate(promo({ isActive: false }), 25_000n)).toEqual({
        isApplicable: false,
        reason: 'This code is no longer available',
      });
    });

    it('rejects a code scoped to a different event', () => {
      expect(evaluate(promo({ eventId: 'other-event' }), 25_000n)).toMatchObject({
        isApplicable: false,
        reason: 'This code does not apply to this event',
      });
    });

    it('accepts an organization-wide code on any event', () => {
      expect(evaluate(promo({ eventId: null }), 25_000n)).toMatchObject({ isApplicable: true });
    });

    it('accepts a code scoped to this event', () => {
      expect(evaluate(promo({ eventId: EVENT }), 25_000n)).toMatchObject({ isApplicable: true });
    });

    it.each([
      { label: 'the instant it opens', validFrom: NOW, isApplicable: true },
      { label: 'a second before it opens', validFrom: new Date(NOW.getTime() + 1_000), isApplicable: false },
    ])('$label', ({ validFrom, isApplicable }) => {
      expect(evaluate(promo({ validFrom }), 25_000n).isApplicable).toBe(isApplicable);
    });

    it.each([
      { label: 'the instant it closes', validUntil: NOW, isApplicable: true },
      { label: 'a second after it closes', validUntil: new Date(NOW.getTime() - 1_000), isApplicable: false },
    ])('$label', ({ validUntil, isApplicable }) => {
      expect(evaluate(promo({ validUntil }), 25_000n).isApplicable).toBe(isApplicable);
    });

    it.each([
      { redemptions: 9, isApplicable: true },
      { redemptions: 10, isApplicable: false },
      { redemptions: 11, isApplicable: false },
    ])('with $redemptions of 10 redemptions used', ({ redemptions, isApplicable }) => {
      expect(evaluate(promo({ maxRedemptions: 10, redemptions }), 25_000n).isApplicable).toBe(
        isApplicable,
      );
    });

    it('does not limit a code with no redemption cap', () => {
      expect(evaluate(promo({ maxRedemptions: null, redemptions: 9_999 }), 25_000n)).toMatchObject({
        isApplicable: true,
      });
    });

    it.each([
      { subtotalMinor: 9_999n, isApplicable: false },
      { subtotalMinor: 10_000n, isApplicable: true },
    ])('with a minimum order of 10000 and a subtotal of $subtotalMinor', ({ subtotalMinor, isApplicable }) => {
      expect(evaluate(promo({ minOrderMinor: 10_000n }), subtotalMinor).isApplicable).toBe(
        isApplicable,
      );
    });

    // The buyer sees this text, so it must say what to do about it.
    it('explains the minimum order in the rejection', () => {
      const result = evaluate(promo({ minOrderMinor: 10_000n }), 1n);
      expect(result).toMatchObject({ isApplicable: false, reason: expect.stringContaining('10000') });
    });
  });
});
