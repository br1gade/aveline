import type {
  SentHousehold,
  SentWire,
  UnreachableHousehold,
  UnreachableWire,
} from '@/features/sending';

/**
 * What `remind` and `thank-you` return (docs/API.md §6). Checked against the schema at each call
 * (FR-1); written from the guide and `reminder.service.ts`, with only the fields the screens read.
 * `read.ts` alone reads the `…Wire` types.
 */

export const THANK_BASES = ['ARRIVED', 'ACCEPTED'] as const;
/** Which rule chose who was thanked: who arrived, or, with no check-in at all, who accepted. */
export type ThankBasis = (typeof THANK_BASES)[number];

/**
 * One press of "remind". A household suppressed on this press is in no list or count, and on a later
 * press the same day is counted in `alreadyRemindedToday`, whatever became of that attempt (FR-85).
 */
export interface ChaseOutcome {
  queued: number;
  alreadyRemindedToday: number;
  /** Invited too recently to chase yet: not an error. */
  recentlyInvited: number;
  recipients: SentHousehold[];
  /** Undecided, and the invitation never reached them: send it, don't remind. */
  toSendFirst: UnreachableHousehold[];
  /** No address to reach them at: fix that first. */
  cannotReach: UnreachableHousehold[];
}

/**
 * One press of "thank". Once ever, so a second press only counts `alreadyThanked`, which includes
 * anyone whose earlier attempt was suppressed or failed (FR-85).
 */
export interface ThankOutcome {
  queued: number;
  alreadyThanked: number;
  basis: ThankBasis | null;
  recipients: SentHousehold[];
  cannotReach: UnreachableHousehold[];
}

export interface ChaseResultWire {
  queued: number;
  alreadyRemindedToday: number;
  recentlyInvited: number;
  recipients: SentWire[];
  notInvited: UnreachableWire[];
}

export interface ThankResultWire {
  queued: number;
  alreadyThanked: number;
  basis: string;
  recipients: SentWire[];
  notInvited: UnreachableWire[];
}
