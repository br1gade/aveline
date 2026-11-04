import {
  JOB_STATUSES,
  type Arrangement,
  type ArrangementWire,
  type JobResult,
  type JobStatus,
  type JobWire,
  type ResultWire,
  type SeatingJob,
  type SeatingTable,
  type TableShape,
  type TableWire,
  type UnseatedHousehold,
  type UnseatedWire,
} from './types';

/**
 * Where seating data arrives. Every object is built by naming its fields, never by spreading the
 * response, so a field added later, or anything a guest's record would carry, stops here. None of
 * these answers carries a guest's token (checked against `seating.service.ts`, `seating-jobs.service.ts`).
 */

export function readArrangements(wire: readonly ArrangementWire[]): Arrangement[] {
  return wire.map((arrangement) => ({
    id: arrangement.id,
    venueId: arrangement.venueId,
    venueName: arrangement.venue?.name ?? null,
    venueCapacity: arrangement.venue?.capacity ?? null,
    revision: arrangement.revision,
    tableCount: arrangement._count?.tables ?? 0,
  }));
}

function shapeOf(shape: string | null | undefined): TableShape {
  return shape === 'rectangle' || shape === 'square' || shape === 'oval' ? shape : 'round';
}

export function readTables(wire: readonly TableWire[]): SeatingTable[] {
  return wire.map((table) => ({
    id: table.id,
    arrangementId: table.arrangementId,
    name: table.name,
    capacity: table.capacity,
    zone: table.zone,
    posX: table.posX ?? null,
    posY: table.posY ?? null,
    shape: shapeOf(table.shape),
    guests: table.guests.map((guest) => ({
      guestId: guest.guestId,
      name: guest.name,
      position: guest.position,
      isReservation: guest.isReservation ?? false,
    })),
    released: (table.released ?? []).map((release) => ({
      guestId: release.guestId,
      name: release.name,
      releasedAt: release.releasedAt,
    })),
  }));
}

const stringOr = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function readUnseated(household: UnseatedWire): UnseatedHousehold {
  return {
    householdId: household.householdId,
    size: household.size,
    reason: household.reason,
    code: stringOr(household.explanation?.code),
    message: stringOr(household.explanation?.userMessage),
  };
}

function readResult(result: ResultWire | null | undefined): JobResult | null {
  if (!result) return null;
  return {
    seated: result.seated ?? 0,
    households: result.households ?? 0,
    unseated: (result.unseated ?? []).map(readUnseated),
  };
}

/** A status this client does not know is read as ended, so the page never waits on it forever. */
function statusOf(value: string): JobStatus {
  return JOB_STATUSES.find((status) => status === value) ?? 'FAILED';
}

export function readJob(job: JobWire): SeatingJob {
  return {
    id: job.id,
    arrangementId: job.arrangementId,
    status: statusOf(job.status),
    attempts: job.attempts,
    failureReason: job.failureReason,
    recoveryMessage: stringOr(job.recovery?.userMessage),
    appliedRevision: job.appliedRevision,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    result: readResult(job.result),
  };
}
