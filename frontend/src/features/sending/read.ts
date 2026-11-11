import {
  CHANNELS,
  DELIVERY_STATUSES,
  FAILURE_KINDS,
  type Channel,
  type DeliveryReport,
  type DeliveryRowWire,
  type DeliveryStatus,
  type DeliveryWire,
  type DesignStatus,
  type DesignStatusWire,
  type Destination,
  type FailureKind,
  type HouseholdDelivery,
  type SendOutcome,
  type SendResultWire,
  type SentHousehold,
  type SentWire,
  type UnreachableHousehold,
  type UnreachableWire,
} from './types';

/**
 * Where the lifecycle calls' answers arrive. Every object is built by naming its fields, never by
 * spreading the response, so anything else in it, a credential included, goes no further.
 */

function channelOf(value: string | undefined): Channel | null {
  return CHANNELS.find((channel) => channel === value) ?? null;
}

/** An address absent, or not text, is "not yours to see" (FR-149). Telegram's is a chat number. */
function addressOf(entry: { toAddress?: unknown }): string | null {
  return typeof entry.toAddress === 'string' ? entry.toAddress : null;
}

function destinationOf(entry: { toAddress?: unknown; channel?: string }): Destination {
  const channel = channelOf(entry.channel);
  return { channel, address: channel === 'TELEGRAM' ? null : addressOf(entry) };
}

/** Only the status and the blockers, out of the whole draft the editor would load. */
export function readDesignStatus(design: DesignStatusWire): DesignStatus {
  return { status: design.status, publishBlockers: [...design.publishBlockers] };
}

export function readSentHousehold(entry: SentWire): SentHousehold {
  return { household: entry.householdName, destination: destinationOf(entry) };
}

export function readUnreachableHousehold(entry: UnreachableWire): UnreachableHousehold {
  return { householdId: entry.householdId, household: entry.householdName, reason: entry.reason };
}

export function readSendResult(result: SendResultWire): SendOutcome {
  return {
    queued: result.queued,
    alreadySent: result.alreadySent,
    recipients: result.recipients.map(readSentHousehold),
    suppressed: result.suppressed.map(readSentHousehold),
    unreachable: result.unreachable.map(readUnreachableHousehold),
  };
}

function failureKindOf(value: string | null | undefined): FailureKind | null {
  return FAILURE_KINDS.find((kind) => kind === value) ?? null;
}

function statusOf(value: string): DeliveryStatus {
  return DELIVERY_STATUSES.find((status) => status === value) ?? 'UNKNOWN';
}

function errorCodeOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function readRow(row: DeliveryRowWire): HouseholdDelivery {
  const destination = destinationOf(row);
  const status = statusOf(row.status);
  return {
    kind: 'reachable',
    householdId: row.householdId,
    recipient: row.guest,
    destination,
    status,
    isRetrying: status === 'QUEUED' && row.attempts > 0,
    // It often quotes the address. The backend withholds it from this role too (FR-35): a second
    // guard, since a read-only role must never see an address.
    failureReason: addressOf(row) === null ? null : (row.failureReason ?? null),
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt ?? null,
    readAt: row.readAt ?? null,
    deliveryFailedAt: row.deliveryFailedAt ?? null,
    deliveryErrorCode: errorCodeOf(row.deliveryErrorCode),
    failureKind: failureKindOf(row.deliveryFailureKind),
    reminders: row.reminders ?? 0,
    lastRemindedAt: row.lastRemindedAt ?? null,
  };
}

/** One entry per household: a row the invitation can reach, or the reason it cannot. */
export function readDelivery(report: DeliveryWire): DeliveryReport {
  const byHousehold = new Map<string, HouseholdDelivery>();
  for (const row of report.households) byHousehold.set(row.householdId, readRow(row));
  for (const entry of report.unreachable) {
    byHousehold.set(entry.householdId, {
      kind: 'unreachable',
      householdId: entry.householdId,
      reason: entry.reason,
    });
  }
  return {
    invited: report.invited,
    notSent: report.notSent,
    unreachable: report.unreachable.length,
    byHousehold,
  };
}
