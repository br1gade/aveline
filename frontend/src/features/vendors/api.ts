import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import { readBookings, readVendors } from './read';
import type { Booking, BookingWire, Vendor, VendorWire } from './types';

type Schemas = components['schemas'];

/**
 * The organization's own vendors and Aveline's curated list. `vendor:read` from an organization or
 * platform role: the route has no event, so someone on an event only is refused (FR-103). Unpaged,
 * and a bare list rather than the envelope of docs/API.md §1 (BACKEND_REQUESTS §3).
 */
export async function listVendors(api: ApiClient): Promise<Vendor[]> {
  return readVendors(await expectData<VendorWire[]>(api.GET('/api/v1/vendors')));
}

/** To this organization, which alone sees it. Nothing can correct or remove it yet (FR-102). */
export async function addVendor(api: ApiClient, body: Schemas['CreateVendorDto']): Promise<void> {
  await expectData<unknown>(api.POST('/api/v1/vendors', { body }));
}

/** The fee only with `vendor:fee:read`, the brief link only with `vendor:write`. */
export async function listBookings(api: ApiClient, eventId: string): Promise<Booking[]> {
  const wire = await expectData<BookingWire[]>(
    api.GET('/api/v1/events/{eventId}/vendors', { params: { path: { eventId } } }),
  );
  return readBookings(wire);
}

/** Engages a vendor and makes their brief link; the same vendor again edits that booking. */
export async function bookVendor(
  api: ApiClient,
  eventId: string,
  body: Schemas['BookVendorDto'],
): Promise<string> {
  const booked = await expectData<{ id: string }>(
    api.POST('/api/v1/events/{eventId}/vendors', { params: { path: { eventId } }, body }),
  );
  return booked.id;
}

/** Into or out of `CANCELLED`, the backend replaces the link. */
export async function changeBooking(
  api: ApiClient,
  ids: { eventId: string; bookingId: string },
  body: Schemas['UpdateBookingDto'],
): Promise<void> {
  await expectData<unknown>(
    api.PATCH('/api/v1/events/{eventId}/vendors/{bookingId}', { params: { path: ids }, body }),
  );
}

/** A new link; the old one stops working at once. The answer's token is not kept: a reload reads it. */
export async function replaceBriefLink(
  api: ApiClient,
  ids: { eventId: string; bookingId: string },
): Promise<void> {
  await expectData<unknown>(
    api.POST('/api/v1/events/{eventId}/vendors/{bookingId}/rotate-brief', {
      params: { path: ids },
    }),
  );
}

/** Ends the engagement: kept as a record, its link replaced so the one sent stops working. */
export async function endBooking(
  api: ApiClient,
  ids: { eventId: string; bookingId: string },
): Promise<void> {
  await expectData<unknown>(
    api.DELETE('/api/v1/events/{eventId}/vendors/{bookingId}', { params: { path: ids } }),
  );
}
