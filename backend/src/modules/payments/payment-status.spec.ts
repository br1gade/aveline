import { PaymentStatus } from '@prisma/client';
import {
  TERMINAL_STATUSES,
  assertTransition,
  canTransition,
  isSettled,
  nextStatusForRefund,
} from './payment-status';

/**
 * Money state must only move forwards. These tests exist because the costly
 * failures in a payment system are not crashes — they are a captured payment
 * silently reverting to pending, or a refunded one being captured again.
 */
describe('payment status machine', () => {
  describe('legal transitions', () => {
    it.each([
      [PaymentStatus.CREATED, PaymentStatus.PENDING],
      [PaymentStatus.CREATED, PaymentStatus.FAILED],
      [PaymentStatus.CREATED, PaymentStatus.EXPIRED],
      [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED],
      [PaymentStatus.PENDING, PaymentStatus.CAPTURED],
      [PaymentStatus.PENDING, PaymentStatus.FAILED],
      [PaymentStatus.PENDING, PaymentStatus.CANCELLED],
      [PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED],
      [PaymentStatus.AUTHORIZED, PaymentStatus.CANCELLED],
      [PaymentStatus.CAPTURED, PaymentStatus.REFUNDED],
      [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED],
      [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
    ])('allows %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });
  });

  describe('illegal transitions', () => {
    it.each([
      [PaymentStatus.CAPTURED, PaymentStatus.PENDING],
      [PaymentStatus.CAPTURED, PaymentStatus.FAILED],
      [PaymentStatus.CAPTURED, PaymentStatus.CAPTURED],
      [PaymentStatus.FAILED, PaymentStatus.CAPTURED],
      [PaymentStatus.CANCELLED, PaymentStatus.CAPTURED],
      [PaymentStatus.REFUNDED, PaymentStatus.CAPTURED],
      [PaymentStatus.EXPIRED, PaymentStatus.AUTHORIZED],
      [PaymentStatus.CREATED, PaymentStatus.CAPTURED],
    ])('refuses %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });

    it('throws with both states named, so a log line explains itself', () => {
      expect(() => assertTransition(PaymentStatus.CAPTURED, PaymentStatus.PENDING)).toThrow(
        /CAPTURED.*PENDING/,
      );
    });
  });

  describe('terminal states', () => {
    it('lets nothing leave a terminal state', () => {
      for (const terminal of TERMINAL_STATUSES) {
        // REFUNDED is terminal; CAPTURED and PARTIALLY_REFUNDED are not.
        const hasAnyAllowedTransition = Object.values(PaymentStatus).some((to) => canTransition(terminal, to));
        expect(hasAnyAllowedTransition).toBe(false);
      }
    });

    it('treats a captured payment as settled and a pending one as not', () => {
      expect(isSettled(PaymentStatus.CAPTURED)).toBe(true);
      expect(isSettled(PaymentStatus.REFUNDED)).toBe(true);
      expect(isSettled(PaymentStatus.PENDING)).toBe(false);
      expect(isSettled(PaymentStatus.AUTHORIZED)).toBe(false);
    });
  });

  describe('refund arithmetic', () => {
    // Boundary set: refunding less than, exactly, and more than what is left.
    it.each([
      { captured: 1000n, already: 0n, refund: 400n, expected: PaymentStatus.PARTIALLY_REFUNDED },
      { captured: 1000n, already: 600n, refund: 400n, expected: PaymentStatus.REFUNDED },
      { captured: 1000n, already: 0n, refund: 1000n, expected: PaymentStatus.REFUNDED },
    ])(
      'refunding $refund of $captured with $already already refunded → $expected',
      ({ captured, already, refund, expected }) => {
        expect(nextStatusForRefund(captured, already, refund)).toBe(expected);
      },
    );

    it.each([
      { captured: 1000n, already: 600n, refund: 500n, label: 'more than remains' },
      { captured: 1000n, already: 0n, refund: 0n, label: 'nothing' },
      { captured: 1000n, already: 0n, refund: -5n, label: 'a negative amount' },
    ])('refuses to refund $label', ({ captured, already, refund }) => {
      expect(() => nextStatusForRefund(captured, already, refund)).toThrow();
    });
  });
});
