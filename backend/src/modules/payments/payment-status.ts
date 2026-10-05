import { ConflictException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

/**
 * Money only moves forwards.
 *
 * The expensive failures in a payment system are not crashes. They are a
 * captured payment quietly reverting to pending because a late callback
 * arrived out of order, or a refunded one being captured a second time. A
 * table of legal transitions makes both impossible to express.
 */
const ALLOWED: Record<PaymentStatus, readonly PaymentStatus[]> = {
  [PaymentStatus.CREATED]: [PaymentStatus.PENDING, PaymentStatus.FAILED, PaymentStatus.EXPIRED],
  [PaymentStatus.PENDING]: [
    PaymentStatus.AUTHORIZED,
    PaymentStatus.CAPTURED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
    PaymentStatus.EXPIRED,
  ],
  [PaymentStatus.AUTHORIZED]: [
    PaymentStatus.CAPTURED,
    PaymentStatus.CANCELLED,
    PaymentStatus.EXPIRED,
  ],
  [PaymentStatus.CAPTURED]: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED],
  // Refunding again is ordinary: a 100,000 capture may be refunded 30,000
  // now and 20,000 later. Only the arithmetic in nextStatusForRefund bounds
  // how much, not the state machine.
  [PaymentStatus.PARTIALLY_REFUNDED]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.EXPIRED]: [],
};

/** States nothing may leave. Reconciliation skips them entirely. */
export const TERMINAL_STATUSES: readonly PaymentStatus[] = Object.values(PaymentStatus).filter(
  (status) => ALLOWED[status].length === 0,
);

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(`Cannot move a payment from ${from} to ${to}`);
  }
}

/** True once the money has stopped moving and no polling is warranted. */
export function isSettled(status: PaymentStatus): boolean {
  return status === PaymentStatus.CAPTURED || TERMINAL_STATUSES.includes(status);
}

/**
 * Refund amounts are compared in minor units as BigInt, so no rounding can
 * let the total refunded drift past what was captured.
 */
export function nextStatusForRefund(
  capturedMinor: bigint,
  alreadyRefundedMinor: bigint,
  refundMinor: bigint,
): PaymentStatus {
  if (refundMinor <= 0n) {
    throw new ConflictException('Refund amount must be positive');
  }

  const remaining = capturedMinor - alreadyRefundedMinor;
  if (refundMinor > remaining) {
    throw new ConflictException(
      `Cannot refund ${refundMinor}; only ${remaining} of ${capturedMinor} remains`,
    );
  }

  return refundMinor === remaining ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
}
