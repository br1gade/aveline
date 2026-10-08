import { MessageStatus } from '@prisma/client';

/**
 * Whether a guest should be sent their invitation again.
 *
 * Decided by what happened to earlier attempts, not by a key per guest. A key
 * per guest made a bounce final: correcting the address changed nothing, and
 * the household was never invited. A key per address is wrong the other way:
 * a guest who links Telegram from their invitation changes their preferred
 * address, and a second press of "send" would invite them twice.
 *
 * So anything that reached them, or is on its way, settles it; when every
 * attempt failed, the next press tries again. Whether *this* address can be
 * tried is not decided here — a hard bounce or an opt-out puts it on the
 * suppression list, which the outbox checks on every message and records as
 * SUPPRESSED. Keeping that in one place is what lets a lifted suppression, or
 * a mailbox that was full for a week, be sent to again.
 */
export interface PreviousAttempt {
  toAddress: string;
  status: MessageStatus;
}

const FAILED_STATUSES: ReadonlySet<MessageStatus> = new Set([
  MessageStatus.FAILED,
  MessageStatus.BOUNCED,
  MessageStatus.SUPPRESSED,
]);

export function hasReachedGuest(previous: PreviousAttempt[]): boolean {
  return previous.some((attempt) => !FAILED_STATUSES.has(attempt.status));
}

/**
 * Whether the latest attempt is a failure at an address the host has since
 * changed — history rather than status, because the new address has simply
 * not been sent to yet.
 */
export function isSupersededFailure(latest: PreviousAttempt | undefined, address: string): boolean {
  if (!latest || !FAILED_STATUSES.has(latest.status)) return false;
  return normalized(latest.toAddress) !== normalized(address);
}

/** Addresses are stored normalized, but an old row may predate that. */
function normalized(address: string): string {
  return address.trim().toLowerCase();
}
