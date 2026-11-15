import { PaymentProvider } from '@prisma/client';
import { DomainHttpException } from '../../common/domain-http.exception';

/** The client has recognised this sentence since before the code existed (FR-109); it stays word for word. */
const PILOT_REFUSAL = 'Payments are disabled for the free pilot';

/** A deployment policy, checked inside every charge flow, not just the client. */
const arePaymentsOff = () => process.env.PILOT_MODE === 'true';

export function assertChargesEnabled(): void {
  if (arePaymentsOff()) throw new DomainHttpException('PAYMENTS_DISABLED', PILOT_REFUSAL);
}

export function assertAmountMayBeCharged(amountMinor: bigint): void {
  if (amountMinor > 0n) assertChargesEnabled();
}

/**
 * Decided 14 November 2026: no paid tickets while payments are off. Refused
 * when the host sets the price, so nobody advertises a ticket that cannot be
 * bought (audit F-09).
 */
export function assertTicketPriceAllowed(priceMinor: bigint | undefined): void {
  if (priceMinor !== undefined && priceMinor > 0n && arePaymentsOff()) {
    throw new DomainHttpException('PAID_TICKETS_DISABLED', 'priceMinor: tickets must be free while payments are off for the free pilot');
  }
}

export interface PaymentOptions {
  isPaymentAvailable: boolean;
  /** The banks a paid order or plan may name as its `provider`; empty while payments are off. */
  providers: PaymentProvider[];
}

export function paymentOptions(configured: PaymentProvider[]): PaymentOptions {
  const providers = arePaymentsOff() ? [] : configured;
  return { isPaymentAvailable: providers.length > 0, providers };
}
