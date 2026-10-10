import { PaymentProvider } from '@prisma/client';

/**
 * What every Armenian gateway we support actually offers.
 *
 * Ameriabank vPOS, Inecobank eCommerce and IDBank's IDPay are all
 * hosted-redirect gateways: register an order, send the payer to the bank's
 * own form, then confirm server-to-server. Because the shape is identical,
 * one port with three thin adapters is cheaper and more honest than three
 * bespoke integrations.
 */
export interface RegisterOrderParams {
  /** Our order reference. Must be unique and must be ours, not the bank's. */
  orderNumber: string;
  amountMinor: bigint;
  currency: string;
  /** Where the bank returns the payer. Never trusted as proof of payment. */
  returnUrl: string;
  description?: string;
  locale?: string;
}

export interface RegisteredOrder {
  /** The bank's reference for this order. */
  providerRef: string;
  /** Hosted form URL to send the payer to. */
  redirectUrl: string;
}

/** Normalised across providers so the service never branches on bank. */
export type ProviderOutcome =
  | { kind: 'pending' }
  | { kind: 'authorized'; amountMinor: bigint }
  | { kind: 'captured'; amountMinor: bigint }
  | { kind: 'refunded'; refundedMinor: bigint }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: string };

export interface ProviderStatus {
  outcome: ProviderOutcome;
  /** Verbatim provider response, stored for dispute reconstruction. */
  raw: unknown;
}

export interface PaymentGateway {
  readonly provider: PaymentProvider;

  registerOrder(params: RegisterOrderParams): Promise<RegisteredOrder>;

  /**
   * The only source of truth about whether money moved. Called after the
   * payer returns, and again by reconciliation for anything unresolved.
   */
  getStatus(providerRef: string): Promise<ProviderStatus>;

  /**
   * Refunds part or all of a captured payment, in the payment's currency.
   * Resolves only when the bank says it refunded; a decline is thrown.
   */
  refund(providerRef: string, amountMinor: bigint, currency: string): Promise<ProviderStatus>;

  cancel(providerRef: string): Promise<ProviderStatus>;
}

/**
 * Currency exponents. AMD is quoted in whole drams, so its minor unit is the
 * dram itself — getting this wrong by one place is a hundredfold error.
 */
const CURRENCY_EXPONENT: Record<string, number> = { AMD: 0, USD: 2, EUR: 2, RUB: 2, GBP: 2 };

export function exponentFor(currency: string): number {
  return CURRENCY_EXPONENT[currency.toUpperCase()] ?? 2;
}

/** Minor units to the decimal string a gateway expects on the wire. */
export function toMajorUnits(amountMinor: bigint, currency: string): string {
  const exponent = exponentFor(currency);
  if (exponent === 0) return amountMinor.toString();

  const divisor = 10n ** BigInt(exponent);
  const whole = amountMinor / divisor;
  const fraction = (amountMinor % divisor).toString().padStart(exponent, '0');
  return `${whole.toString()}.${fraction}`;
}

/** The inverse, for reading amounts back out of a provider response. */
export function toMinorUnits(amount: string | number, currency: string): bigint {
  const exponent = exponentFor(currency);
  const [whole = '0', fraction = ''] = String(amount).split('.');
  const padded = fraction.padEnd(exponent, '0').slice(0, exponent);
  return BigInt(whole) * 10n ** BigInt(exponent) + BigInt(padded || '0');
}

/** How long any one call to a bank may take before it is abandoned. */
export const BANK_TIMEOUT_MS = 15_000;

/**
 * The bank answered, and the answer was no. Only this releases a claimed
 * refund: any other failure — a timeout, a dropped connection, our own write
 * after the bank's yes — leaves it unknown whether money moved.
 */
export class BankDeclinedError extends Error {}
