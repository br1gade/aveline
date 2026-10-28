import {
  CHANNELS,
  DELIVERY_STATUSES,
  type Channel,
  type DeliveryReport,
  type DeliveryRowWire,
  type DeliveryStatus,
  type DeliveryWire,
  type DesignStatus,
  type DesignStatusWire,
  type Destination,
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

/** `in`, not a null check: a missing address is "not yours to see". Telegram's is a chat number. */
function destinationOf(entry: { toAddress?: string; channel?: string }): Destination {
  const channel = channelOf(entry.channel);
  const isShown = 'toAddress' in entry && typeof entry.toAddress === 'string';
  return { channel, address: isShown && channel !== 'TELEGRAM' ? (entry.toAddress ?? null) : null };
}

/** Only the status and the blockers, out of the whole draft the editor would load. */
export function readDesignStatus(design: DesignStatusWire): DesignStatus {
  return { status: design.status, publishBlockers: [...design.publishBlockers] };
}

function readSent(entry: SentWire): SentHousehold {
  return { household: entry.householdName, destination: destinationOf(entry) };
}

function readUnreachable(entry: UnreachableWire): UnreachableHousehold {
  return { householdId: entry.householdId, household: entry.householdName, reason: entry.reason };
}

export function readSendResult(result: SendResultWire): SendOutcome {
  return {
    queued: result.queued,
    alreadySent: result.alreadySent,
    recipients: result.recipients.map(readSent),
    suppressed: result.suppressed.map(readSent),
    unreachable: result.unreachable.map(readUnreachable),
  };
}

function statusOf(value: string): DeliveryStatus {
  return DELIVERY_STATUSES.find((status) => status === value) ?? 'UNKNOWN';
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
    // The server's reply often quotes the address, which this role may not see (FR-35).
    failureReason: 'toAddress' in row ? row.failureReason : null,
    sentAt: row.sentAt,
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
