import type { ApiClient } from '@/api/client';
import { getEvent, type EventDetail } from '@/features/events';

import { listBookings, listVendorChoices, listVendors } from './api';
import { vendorRefusalOf, type VendorAction, type VendorRefusal } from './refusals';
import type { Booking, Vendor, VendorChoices } from './types';

/** A read a page shows, or the refusal it words in its place (FR-6). */
export type VendorRead<T> =
  { kind: 'ready'; value: T } | { kind: 'refused'; refusal: VendorRefusal };

async function readOrRefusal<T>(read: Promise<T>, action: VendorAction): Promise<VendorRead<T>> {
  try {
    return { kind: 'ready', value: await read };
  } catch (error) {
    return { kind: 'refused', refusal: vendorRefusalOf(error, action) };
  }
}

export interface VendorsData {
  vendors: VendorRead<Vendor[]>;
}

export async function loadVendors(api: ApiClient): Promise<VendorsData> {
  return { vendors: await readOrRefusal(listVendors(api), 'list') };
}

export interface EventVendorsData {
  event: EventDetail;
  bookings: VendorRead<Booking[]>;
}

export async function loadEventVendors(api: ApiClient, eventId: string): Promise<EventVendorsData> {
  const [event, bookings] = await Promise.all([
    getEvent(api, eventId),
    readOrRefusal(listBookings(api, eventId), 'bookings'),
  ]);
  return { event, bookings };
}

export interface NewBookingData extends EventVendorsData {
  /** What can be booked on this event, and each kind's usual sections (FR-103, FR-105). */
  choices: VendorRead<VendorChoices>;
}

/** The bookings mark who is booked already, which the form opens rather than posts again. */
export async function loadNewBooking(api: ApiClient, eventId: string): Promise<NewBookingData> {
  const [current, choices] = await Promise.all([
    loadEventVendors(api, eventId),
    readOrRefusal(listVendorChoices(api, eventId), 'choices'),
  ]);
  return { ...current, choices };
}

export interface BookingData {
  event: EventDetail;
  /** `missing`: not, or no longer, on this event. */
  booking: VendorRead<Booking> | { kind: 'missing' };
}

/** The API has no single booking's read, so the event's list is read and the one picked from it. */
export async function loadBooking(
  api: ApiClient,
  ids: { eventId: string; bookingId: string },
): Promise<BookingData> {
  const { event, bookings } = await loadEventVendors(api, ids.eventId);
  if (bookings.kind === 'refused') return { event, booking: bookings };
  const booking = bookings.value.find((each) => each.id === ids.bookingId);
  return { event, booking: booking ? { kind: 'ready', value: booking } : { kind: 'missing' } };
}
