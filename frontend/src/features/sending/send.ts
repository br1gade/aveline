import { oneByOne } from '@/lib/queue';

import type { DeliveryReport, SendOutcome } from './types';

/** The most guest ids one send takes (`SendInvitationDto`, `@ArrayMaxSize(1000)`). */
export const SEND_LIMIT = 1000;

/**
 * Whether this send is the event's first, which asks once before going (design PD-47): nothing
 * has been sent to any household yet, or the report could not be read, so nobody can tell. After
 * that a press sends at once; the backend makes a second press safe (docs/API.md §6).
 */
export function needsConfirmation(report: DeliveryReport | null): boolean {
  return report === null || report.invited === 0;
}

/**
 * One guest of each chosen household: naming any member invites the whole household, which is
 * the unit an invitation goes to (docs/API.md §6). A household always has a guest; the backend
 * removes an empty one.
 */
export function guestIdsFor(
  households: ReadonlyArray<{ guests: ReadonlyArray<{ id: string }> }>,
): string[] {
  return households.flatMap(({ guests }) => (guests[0] ? [guests[0].id] : []));
}

/** The guests in sends of at most `SEND_LIMIT`, in their order (design PD-151). */
export function sendBatches(guestIds: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < guestIds.length; start += SEND_LIMIT) {
    batches.push(guestIds.slice(start, start + SEND_LIMIT));
  }
  return batches;
}

/** What two sends did, as one. */
export function mergeOutcomes(first: SendOutcome, second: SendOutcome): SendOutcome {
  return {
    queued: first.queued + second.queued,
    alreadySent: first.alreadySent + second.alreadySent,
    recipients: [...first.recipients, ...second.recipients],
    suppressed: [...first.suppressed, ...second.suppressed],
    unreachable: [...first.unreachable, ...second.unreachable],
  };
}

export interface BatchedSend {
  /** What the sends that went did; `null` when the first was refused. */
  outcome: SendOutcome | null;
  /** How many of the guests named went, so how many households. */
  sent: number;
  /** The refusal that stopped it; `null` when everyone went. */
  error: unknown;
}

/**
 * More guests than one send takes, sent a part at a time and stopped at the first refusal (design
 * PD-151). Pressing again is safe: the backend sends no household reached a second invitation, and
 * counts it in `alreadySent` (docs/API.md §6).
 */
export async function sendInBatches(
  guestIds: readonly string[],
  send: (batch: readonly string[]) => Promise<SendOutcome>,
  onBatch?: (index: number, total: number) => void,
): Promise<BatchedSend> {
  const batches = sendBatches(guestIds);
  let outcome: SendOutcome | null = null;
  let index = 0;
  const { done, error } = await oneByOne(batches, async (batch) => {
    onBatch?.(index, batches.length);
    index += 1;
    const result = await send(batch);
    outcome = outcome ? mergeOutcomes(outcome, result) : result;
  });
  return { outcome, sent: done.reduce((count, batch) => count + batch.length, 0), error };
}
