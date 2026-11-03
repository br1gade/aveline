import { expectData, type ApiClient } from '@/api/client';

import { readAdmission, readArrival, readCounts } from './read';
import type {
  AdmitWire,
  ArrivalCounts,
  ArrivalsWire,
  CheckInWire,
  DoorAdmission,
  DoorArrival,
} from './types';

/**
 * Without these a request on a poor signal never ends, and neither does its spinner (design PD-94).
 * A timed-out call reads as no answer, which `expectData` makes of an abort.
 */
const WRITE_TIME_MS = 10_000;
const READ_TIME_MS = 20_000;

export function readDeadline(): AbortSignal {
  return AbortSignal.timeout(READ_TIME_MS);
}

/** Needs `guest:write`. A second arrival is refused; see `refusals.ts`. */
export async function checkIn(
  api: ApiClient,
  eventId: string,
  guestId: string,
): Promise<DoorArrival> {
  const wire = await expectData<CheckInWire>(
    api.POST('/api/v1/events/{eventId}/guests/{guestId}/check-in', {
      params: { path: { eventId, guestId } },
      signal: AbortSignal.timeout(WRITE_TIME_MS),
    }),
  );
  return readArrival(wire);
}

/** Needs `guest:write`. For a ticket-linked guest it also makes the ticket valid again. */
export async function undoCheckIn(api: ApiClient, eventId: string, guestId: string): Promise<void> {
  await expectData<unknown>(
    api.DELETE('/api/v1/events/{eventId}/guests/{guestId}/check-in', {
      params: { path: { eventId, guestId } },
      signal: AbortSignal.timeout(WRITE_TIME_MS),
    }),
  );
}

/**
 * Needs `guest:write`. The code travels in the request's path, as the API requires; the backend's
 * logs and `redactUrl` both replace it, and it goes nowhere else.
 */
export async function admitTicket(
  api: ApiClient,
  eventId: string,
  code: string,
): Promise<DoorAdmission> {
  const wire = await expectData<AdmitWire>(
    api.POST('/api/v1/events/{eventId}/tickets/{code}/admit', {
      params: { path: { eventId, code } },
      signal: AbortSignal.timeout(WRITE_TIME_MS),
    }),
  );
  return readAdmission(wire);
}

/** Needs `operations:read`. */
export async function getArrivals(api: ApiClient, eventId: string): Promise<ArrivalCounts> {
  const wire = await expectData<ArrivalsWire>(
    api.GET('/api/v1/events/{eventId}/arrivals', {
      params: { path: { eventId } },
      signal: readDeadline(),
    }),
  );
  return readCounts(wire);
}
