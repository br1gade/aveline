/**
 * Why a send failed, and what to do about it.
 *
 * This matters the moment a real transport exists. Until now every channel
 * resolved to the console and nothing could fail, so the dispatcher treated
 * every failure as final — a momentary network blip would have permanently
 * lost an invitation. With real SMTP, the three outcomes need three different
 * responses, and conflating them is how a product either loses mail or keeps
 * hammering an address that will never accept it.
 *
 * Pure, because the classification is a judgement about provider behaviour
 * that must be reviewable and testable without a mail server.
 */
export type FailureKind =
  /** The recipient will never accept it: no such mailbox, blocked. */
  | 'UNDELIVERABLE'
  /** The provider could not take it now: timeout, throttle, greylisting. */
  | 'TEMPORARY'
  /** Our configuration is wrong: bad credentials, no sending domain. */
  | 'MISCONFIGURED';

export interface DeliveryFailure {
  kind: FailureKind;
  reason: string;
}

/**
 * How many times one message is attempted before it is given up on.
 *
 * Five spread over the backoff below covers roughly seven hours, which clears
 * a greylisting delay and a short provider outage without holding an
 * invitation past the point where the host would rather know it failed.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Backoff as a table, not a formula.
 *
 * A reader can see the whole retry schedule at a glance and an operator can
 * answer "when will it try again" without running the code.
 */
const RETRY_DELAYS_MS: readonly number[] = [
  60_000, // 1 minute
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
];

/** Node and nodemailer socket-level codes that mean "not now". */
const TEMPORARY_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNECTION',
  'EAI_AGAIN',
  'EDNS',
  'EPIPE',
]);

/** Codes that mean the server will not take our mail until we fix something. */
const MISCONFIGURATION_ERROR_CODES = new Set(['EAUTH', 'ESECURITY', 'ETLS']);

/**
 * SMTP replies in the 5xx range are permanent by the RFC — with one exception
 * that matters in practice: 421 is a 4xx, and 450/451/452 are the ordinary
 * greylisting and over-quota replies, so the range test is what decides.
 */
export function classifyDeliveryFailure(error: unknown): DeliveryFailure {
  const reason = describe(error);
  const code = stringProperty(error, 'code');

  if (code !== undefined && MISCONFIGURATION_ERROR_CODES.has(code)) {
    return { kind: 'MISCONFIGURED', reason };
  }
  if (code !== undefined && TEMPORARY_ERROR_CODES.has(code)) {
    return { kind: 'TEMPORARY', reason };
  }

  const responseCode = numberProperty(error, 'responseCode');
  if (responseCode !== undefined) {
    return {
      kind: responseCode >= 500 && responseCode < 600 ? 'UNDELIVERABLE' : 'TEMPORARY',
      reason,
    };
  }

  // An error we do not recognise is treated as temporary. Being wrong that way
  // costs a few retries; being wrong the other way suppresses an address that
  // was never at fault, and a suppression is far harder to notice and undo.
  return { kind: 'TEMPORARY', reason };
}

/** Whether another attempt is worth making. */
export function isWorthRetrying(kind: FailureKind, attempts: number): boolean {
  if (kind === 'UNDELIVERABLE') return false;
  return attempts < MAX_DELIVERY_ATTEMPTS;
}

/** When the next attempt is due, given how many have already been made. */
export function nextAttemptAt(attempts: number, now: Date): Date {
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1;
  return new Date(now.getTime() + RETRY_DELAYS_MS[index]);
}

/**
 * Only an UNDELIVERABLE failure suppresses the address, and only then because
 * the recipient themselves refused it. A timeout or a bad password is ours,
 * and suppressing on either would punish a guest for our outage.
 */
export function shouldSuppressAddress(kind: FailureKind): boolean {
  return kind === 'UNDELIVERABLE';
}

function describe(error: unknown): string {
  const response = stringProperty(error, 'response');
  if (response !== undefined) return response;
  if (error instanceof Error) return error.message;
  return String(error);
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : undefined;
}

function numberProperty(value: unknown, key: string): number | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'number' ? property : undefined;
}
