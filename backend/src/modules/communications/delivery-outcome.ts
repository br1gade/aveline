/**
 * Why a send failed, and what to do about it.
 *
 * This matters the moment a real transport exists. Until now every channel
 * resolved to the console and nothing could fail, so the dispatcher treated
 * every failure as final — a momentary network blip would have permanently
 * lost an invitation. Recipient bounces, temporary errors, configuration
 * faults and message-level restrictions need distinct treatment; a restriction
 * on one message must never become a global address suppression.
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
  | 'MISCONFIGURED'
  /** Provider explicitly forbids this message; this is not a global address bounce. */
  | 'REJECTED';

export interface DeliveryFailure {
  kind: FailureKind;
  reason: string;
  retryAfterMs?: number;
}

/**
 * How many times one message is attempted before it is given up on.
 *
 * Attempts are bounded independently of provider-directed backoff. A minimum
 * retry delay can extend the ordinary schedule without burning attempts
 * during a known provider restriction window.
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

/**
 * Codes that mean the server will not take our mail until we fix something.
 * ECONFIG is our own: a chat transport saying the request itself was wrong — a
 * missing template, a message too long — which is never the recipient's fault.
 */
const MISCONFIGURATION_ERROR_CODES = new Set(['EAUTH', 'ESECURITY', 'ETLS', 'ECONFIG']);

/**
 * SMTP replies in the 5xx range are permanent by the RFC — with one exception
 * that matters in practice: 421 is a 4xx, and 450/451/452 are the ordinary
 * greylisting and over-quota replies, so the range test is what decides.
 */
export function classifyDeliveryFailure(error: unknown): DeliveryFailure {
  const reason = describe(error);
  const code = stringProperty(error, 'code');

  if (code === 'EREJECTED') return { kind: 'REJECTED', reason };
  if (code !== undefined && MISCONFIGURATION_ERROR_CODES.has(code)) {
    return { kind: 'MISCONFIGURED', reason };
  }
  if (code !== undefined && TEMPORARY_ERROR_CODES.has(code)) {
    return { kind: 'TEMPORARY', reason };
  }

  const responseCode = numberProperty(error, 'responseCode');
  if (responseCode !== undefined) {
    return { kind: kindOfReply(responseCode, reason), reason, retryAfterMs: numberProperty(error, 'retryAfterMs') };
  }

  // An error we do not recognise is treated as temporary. Being wrong that way
  // costs a few retries; being wrong the other way suppresses an address that
  // was never at fault, and a suppression is far harder to notice and undo.
  return { kind: 'TEMPORARY', reason };
}

/**
 * A 4xx is "not now". A 5xx is permanent — but permanent for whom decides
 * everything, because the recipient's refusal suppresses their address for
 * every customer. Only the enhanced status codes that name the address
 * (5.1.x: no such mailbox; 5.2.1: disabled) count against them, and without
 * an enhanced code only 550/551/553. Everything else — our quota (5.4.5),
 * size (5.3.4), policy and spam judgements (5.7.x), a bare 554 — is ours, and
 * used to put every guest after the five-hundredth of the day on the list.
 */
function kindOfReply(responseCode: number, reason: string): FailureKind {
  if (responseCode < 500 || responseCode >= 600) return 'TEMPORARY';

  const enhanced = /\b5\.(\d{1,3})\.(\d{1,3})\b/.exec(reason);
  if (enhanced) return isRecipientFault(enhanced[1], enhanced[2]) ? 'UNDELIVERABLE' : 'MISCONFIGURED';
  return RECIPIENT_REPLY_CODES.has(responseCode) ? 'UNDELIVERABLE' : 'MISCONFIGURED';
}

/** Basic SMTP replies that, alone, mean the address is wrong. */
const RECIPIENT_REPLY_CODES: ReadonlySet<number> = new Set([550, 551, 553]);

function isRecipientFault(subject: string, detail: string): boolean {
  return subject === '1' || (subject === '2' && detail === '1');
}

/** Whether another attempt is worth making. */
export function isWorthRetrying(kind: FailureKind, attempts: number): boolean {
  if (kind === 'UNDELIVERABLE' || kind === 'REJECTED') return false;
  return attempts < MAX_DELIVERY_ATTEMPTS;
}

/** When the next attempt is due, given how many have already been made. */
export function nextAttemptAt(attempts: number, now: Date, minimumDelayMs = 0): Date {
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1;
  const providerDelay = Number.isFinite(minimumDelayMs) ? Math.max(0, Math.min(minimumDelayMs, 86400000)) : 0;
  return new Date(now.getTime() + Math.max(RETRY_DELAYS_MS[index], providerDelay));
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
