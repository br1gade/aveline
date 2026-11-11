import { expectData, type ApiClient } from '@/api/client';

import { readAdmission, readArrival, readCounts, readRoster } from './read';

import type { ArrivalCounts, DoorAdmission, DoorArrival } from './types';

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
  const wire = await expectData(
    api.POST('/api/v1/events/{eventId}/guests/{guestId}/check-in', {
      params: { path: { eventId, guestId } },
      signal: AbortSignal.timeout(WRITE_TIME_MS),
    }),
  );
  return readArrival(wire);
}

/** Needs `guest:write`. For a ticket-linked guest it also makes the ticket valid again. */
export async function undoCheckIn(api: ApiClient, eventId: string, guestId: string): Promise<void> {
  await expectData(
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
  const wire = await expectData(
    api.POST('/api/v1/events/{eventId}/tickets/{code}/admit', {
      params: { path: { eventId, code } },
      signal: AbortSignal.timeout(WRITE_TIME_MS),
    }),
  );
  return readAdmission(wire);
}

/** A roster page: as many as the API allows at once (docs/API.md §6: 1–100). */
const ROSTER_PAGE = 100;
/** The longest search the roster takes. */
const SEARCH_LENGTH = 120;

/**
 * Needs `guest:read`. One page of the roster, after `cursor`, or the people matching `search`; a
 * search is followed with the same words (docs/API.md §6, "Door roster").
 */
export async function listDoorRoster(
  api: ApiClient,
  eventId: string,
  query: { cursor?: string; search?: string },
) {
  const search = query.search?.slice(0, SEARCH_LENGTH);
  const wire = await expectData(
    api.GET('/api/v1/events/{eventId}/door-roster', {
      params: {
        path: { eventId },
        query: {
          limit: ROSTER_PAGE,
          ...(query.cursor ? { cursor: query.cursor } : {}),
          ...(search ? { search } : {}),
        },
      },
      signal: readDeadline(),
    }),
  );
  return readRoster(wire);
}

/** Needs `operations:read`. */
export async function getArrivals(api: ApiClient, eventId: string): Promise<ArrivalCounts> {
  const wire = await expectData(
    api.GET('/api/v1/events/{eventId}/arrivals', {
      params: { path: { eventId } },
      signal: readDeadline(),
    }),
  );
  return readCounts(wire);
}
