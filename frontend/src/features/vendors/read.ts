import { DEFAULT_FEE_CURRENCY } from './payload';
import { inSectionOrder, isBookingStatus, isVendorCategory } from './scopes';
import type {
  Booking,
  BookingStatus,
  BookingWire,
  BriefLink,
  Fee,
  Vendor,
  VendorCategory,
  VendorChoices,
  VendorOptionsWire,
  VendorWire,
} from './types';

/** A kind the client doesn't know yet reads as "other", never as one it knows. */
function categoryOf(category: string): VendorCategory {
  return isVendorCategory(category) ? category : 'OTHER';
}

function statusOf(status: string): BookingStatus {
  return isBookingStatus(status) ? status : 'ENQUIRED';
}

/** The organization's own and Aveline's curated list, in the API's order; every field named. */
export function readVendors(wire: readonly VendorWire[]): Vendor[] {
  return wire.map((vendor) => ({
    id: vendor.id,
    name: vendor.name,
    category: categoryOf(vendor.category),
    email: vendor.email,
    phone: vendor.phone,
    notes: vendor.notes ?? null,
    isCurated: vendor.isCurated,
    halls: vendor.venueProfiles.map(({ id, name, city, capacity }) => ({
      id,
      name,
      city,
      capacity,
    })),
  }));
}

/** What a booking can be made with, every page of it, and each kind's usual sections (FR-103, FR-105). */
export function readChoices(
  items: readonly VendorOptionsWire['items'][number][],
  defaults: VendorOptionsWire['defaults'],
): VendorChoices {
  return {
    choices: items.map(({ id, name, category, isCurated }) => ({
      id,
      name,
      category: categoryOf(category),
      isCurated,
    })),
    usualSections: new Map(
      defaults.map(({ category, scopes }) => [categoryOf(category), inSectionOrder(scopes)]),
    ),
  };
}

/** A missing `feeMinor` is withheld from this role; `null` is no fee agreed (FR-6). */
function feeOf(booking: BookingWire): Fee {
  if (booking.feeMinor === undefined) return { isShown: false };
  return {
    isShown: true,
    amountMinor: booking.feeMinor,
    currency: booking.feeCurrency ?? DEFAULT_FEE_CURRENCY,
  };
}

function linkOf(booking: BookingWire): BriefLink {
  return booking.briefToken ? { isShown: true, token: booking.briefToken } : { isShown: false };
}

/** The event's bookings, oldest first as the API lists them; every field named. */
export function readBookings(wire: readonly BookingWire[]): Booking[] {
  return wire.map((booking) => ({
    id: booking.id,
    vendor: {
      id: booking.vendor.id,
      name: booking.vendor.name,
      category: categoryOf(booking.vendor.category),
      email: booking.vendor.email,
      phone: booking.vendor.phone,
    },
    status: statusOf(booking.status),
    scopes: inSectionOrder(booking.briefScopes),
    fee: feeOf(booking),
    link: linkOf(booking),
    isBriefEnabled: booking.isBriefEnabled,
  }));
}
