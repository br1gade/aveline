import type { InvitationStatus } from '@/features/events';

/**
 * What the invitation's lifecycle calls return (docs/API.md §6: "Loading the invitation into the
 * editor", "Publishing the invitation", "Sending the invitation", "Which channel a message goes out
 * on", and the delivery report). Interim until FR-1: written from the guide and the backend's
 * services, with only the fields the screens read. `read.ts` alone reads the `…Wire` types.
 *
 * None of these responses carries a guest's token; `read.ts` still names every field it keeps, so
 * nothing added later goes further.
 */

export const CHANNELS = ['EMAIL', 'TELEGRAM', 'WHATSAPP', 'SMS'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * Where a message went. `address` is missing for a role without `guest:contact:read` ("not yours
 * to see", not empty), and for Telegram, whose address is a chat number that means nothing to a
 * host. `channel` is missing where the response does not say.
 */
export interface Destination {
  channel: Channel | null;
  address: string | null;
}

/** The draft's state as the editor reads it; only these two fields are kept. */
export interface DesignStatus {
  status: InvitationStatus;
  /** English sentences (FR-32); `blockers.ts` words the ones it knows. */
  publishBlockers: string[];
}

export interface SentHousehold {
  household: string;
  destination: Destination;
}

export interface UnreachableHousehold {
  householdId: string;
  household: string;
  /** Written by the backend for a host to read, in English (FR-33). Never quotes an address. */
  reason: string;
}

/** One press of "send": three lists, because each needs a different action from the host. */
export interface SendOutcome {
  queued: number;
  /** Households already invited, or on the way: not sent another (docs/API.md §6). */
  alreadySent: number;
  recipients: SentHousehold[];
  /** Opted out, or an earlier message bounced; the response does not say which (FR-33). */
  suppressed: SentHousehold[];
  unreachable: UnreachableHousehold[];
}

/** A `Message` status, `NOT_SENT` for nothing sent yet, or `UNKNOWN` for a status added later. */
export const DELIVERY_STATUSES = [
  'NOT_SENT',
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'BOUNCED',
  'SUPPRESSED',
  'CANCELLED',
  'UNKNOWN',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** A household the invitation can reach, and what happened to its latest invitation. */
export interface Reachable {
  kind: 'reachable';
  householdId: string;
  /** The guest it goes to: the primary, or whoever in the household has an address. */
  recipient: string;
  destination: Destination;
  status: DeliveryStatus;
  /** Queued again after a temporary failure: being retried, not stuck. */
  isRetrying: boolean;
  /**
   * The mail server's own words, in English. Kept only when the address arrived too: it often
   * quotes the address (FR-35).
   */
  failureReason: string | null;
  /** ISO 8601 UTC; shown in the event's zone. */
  sentAt: string | null;
  /** When the provider reported it read (WhatsApp); the status stays DELIVERED. */
  readAt: string | null;
  /** Why a provider reported it failed, when it said; only CONFIGURATION changes what to do. */
  failureKind: FailureKind | null;
  reminders: number;
  lastRemindedAt: string | null;
}

export const FAILURE_KINDS = ['CONFIGURATION', 'TRANSIENT', 'AMBIGUOUS', 'UNKNOWN'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export interface Unreachable {
  kind: 'unreachable';
  householdId: string;
  reason: string;
}

export type HouseholdDelivery = Reachable | Unreachable;

/** The delivery report, one entry per household, found by its id. */
export interface DeliveryReport {
  /** Households with any invitation attempt, failed ones included. */
  invited: number;
  notSent: number;
  unreachable: number;
  byHousehold: ReadonlyMap<string, HouseholdDelivery>;
}

export interface DesignStatusWire {
  status: InvitationStatus;
  publishBlockers: string[];
}

export interface LifecycleWire {
  slug: string;
  status: InvitationStatus;
}

export interface SentWire {
  householdName: string;
  toAddress?: string;
  channel?: string;
}

export interface UnreachableWire {
  householdId: string;
  householdName: string;
  reason: string;
}

export interface SendResultWire {
  queued: number;
  alreadySent: number;
  recipients: SentWire[];
  suppressed: SentWire[];
  unreachable: UnreachableWire[];
}

export interface DeliveryRowWire {
  householdId: string;
  household: string;
  guest: string;
  channel?: string;
  toAddress?: string;
  status: string;
  attempts: number;
  failureReason: string | null;
  sentAt: string | null;
  reminders?: number;
  lastRemindedAt?: string | null;
  /** Since `eb77cd4`: provider receipts. */
  readAt?: string | null;
  deliveryFailureKind?: string | null;
}

export interface DeliveryWire {
  invited: number;
  notSent: number;
  unreachable: UnreachableWire[];
  households: DeliveryRowWire[];
}
