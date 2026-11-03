import { readSentHousehold, readUnreachableHousehold } from '@/features/sending';

import {
  THANK_BASES,
  type ChaseOutcome,
  type ChaseResultWire,
  type ThankBasis,
  type ThankOutcome,
  type ThankResultWire,
} from './types';

/**
 * Where the two sends' answers arrive. Every object is built by naming its fields, so anything else
 * in them, a credential included, goes no further.
 */

/**
 * The one `notInvited` reason whose fix is to send (`reminder.service.ts`). **A temporary stand-in:**
 * recognised by its exact words, under a test that reads the source, until FR-33 gives codes.
 */
export const NOT_REACHED_REASON =
  'The invitation has not reached this household; send it to them instead';

export function readChaseResult(result: ChaseResultWire): ChaseOutcome {
  const notInvited = result.notInvited.map(readUnreachableHousehold);
  return {
    queued: result.queued,
    alreadyRemindedToday: result.alreadyRemindedToday,
    recentlyInvited: result.recentlyInvited,
    recipients: result.recipients.map(readSentHousehold),
    toSendFirst: notInvited.filter((entry) => entry.reason === NOT_REACHED_REASON),
    cannotReach: notInvited.filter((entry) => entry.reason !== NOT_REACHED_REASON),
  };
}

function basisOf(value: string): ThankBasis | null {
  return THANK_BASES.find((basis) => basis === value) ?? null;
}

export function readThankResult(result: ThankResultWire): ThankOutcome {
  return {
    queued: result.queued,
    alreadyThanked: result.alreadyThanked,
    basis: basisOf(result.basis),
    recipients: result.recipients.map(readSentHousehold),
    cannotReach: result.notInvited.map(readUnreachableHousehold),
  };
}
