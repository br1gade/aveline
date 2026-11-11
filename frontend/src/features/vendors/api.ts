import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import { readBookings, readChoices, readVendors } from './read';
import type { Booking, Vendor, VendorChoices, VendorOptionsWire } from './types';

type Schemas = components['schemas'];

/** The most the options read gives at once, and the furthest it pages (docs/API.md §6). */
const CHOICES_PAGE = 100;
const CHOICES_MAX_OFFSET = 10_000;

/**
 * The organization's own vendors and Aveline's curated list. `vendor:read` from an organization or
 * platform role: the route has no event. Unpaged, and a bare list rather than the envelope of
 * docs/API.md §1 (BACKEND_REQUESTS §3). Notes come only to a role that may edit them (FR-102).
 */
export async function listVendors(api: ApiClient): Promise<Vendor[]> {
  return readVendors(await expectData(api.GET('/api/v1/vendors')));
}

/**
 * What a booking on this event can be made with, for anyone with `vendor:read` on it, an event-only
 * collaborator included (FR-103), with each kind's usual sections (FR-105). Read whole, a page at a
 * time, as the booking form offers every choice.
 */
export async function listVendorChoices(api: ApiClient, eventId: string): Promise<VendorChoices> {
  // A vendor added or removed between pages shifts the next one; keyed by id, none shows twice.
  const items = new Map<string, VendorOptionsWire['items'][number]>();
  let page: VendorOptionsWire;
  let offset = 0;
  do {
    page = await expectData(
      api.GET('/api/v1/events/{eventId}/vendor-options', {
        params: { path: { eventId }, query: { limit: CHOICES_PAGE, offset } },
      }),
    );
    for (const item of page.items) items.set(item.id, item);
    offset += CHOICES_PAGE;
  } while (page.hasMore && offset <= CHOICES_MAX_OFFSET);
  return readChoices([...items.values()], page.defaults);
}

/** To this organization, which alone sees it. */
export async function addVendor(api: ApiClient, body: Schemas['CreateVendorDto']): Promise<void> {
  await expectData(api.POST('/api/v1/vendors', { body }));
}

/** Only the organization's own; a curated or foreign vendor is a 404 (FR-102). */
export async function correctVendor(
  api: ApiClient,
  vendorId: string,
  body: Schemas['UpdateVendorDto'],
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/vendors/{vendorId}', { params: { path: { vendorId } }, body }),
  );
}

/** Hides it from the list and new bookings; its bookings and their links are kept (FR-102). */
export async function removeVendor(api: ApiClient, vendorId: string): Promise<void> {
  await expectData(api.DELETE('/api/v1/vendors/{vendorId}', { params: { path: { vendorId } } }));
}

/** The fee only with `vendor:fee:read`, the brief link only with `vendor:write`. */
export async function listBookings(api: ApiClient, eventId: string): Promise<Booking[]> {
  return readBookings(
    await expectData(
      api.GET('/api/v1/events/{eventId}/vendors', { params: { path: { eventId } } }),
    ),
  );
}

/** Engages a vendor and makes their brief link; the same vendor again edits that booking. */
export async function bookVendor(
  api: ApiClient,
  eventId: string,
  body: Schemas['BookVendorDto'],
): Promise<string> {
  const booked = await expectData(
    api.POST('/api/v1/events/{eventId}/vendors', { params: { path: { eventId } }, body }),
  );
  return booked.id;
}

/**
 * State, sections, fee, or pausing the brief (`isBriefEnabled`, FR-108), which keeps the booking and
 * its link. Engaging an ended booking again gives the vendor a new link.
 */
export async function changeBooking(
  api: ApiClient,
  ids: { eventId: string; bookingId: string },
  body: Schemas['UpdateBookingDto'],
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/events/{eventId}/vendors/{bookingId}', { params: { path: ids }, body }),
  );
}

/** A new link; the old one stops working at once. The answer's token is not kept: a reload reads it. */
export async function replaceBriefLink(
  api: ApiClient,
  ids: { eventId: string; bookingId: string },
): Promise<void> {
  await expectData(
    api.POST('/api/v1/events/{eventId}/vendors/{bookingId}/rotate-brief', {
      params: { path: ids },
    }),
  );
}

/** Ends the engagement, kept as a record: the link sent then answers 403 until it is engaged again. */
export async function endBooking(
  api: ApiClient,
  ids: { eventId: string; bookingId: string },
): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/events/{eventId}/vendors/{bookingId}', { params: { path: ids } }),
  );
}
