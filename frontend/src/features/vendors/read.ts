import { FEE_CURRENCY } from './payload';
import { inSectionOrder, isBookingStatus, isVendorCategory } from './scopes';
import type {
  Booking,
  BookingStatus,
  BookingWire,
  BriefLink,
  Fee,
  Vendor,
  VendorCategory,
  VendorWire,
} from './types';

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
    isCurated: vendor.isCurated,
    halls: (vendor.venueProfiles ?? []).map(({ id, name, city, capacity }) => ({
      id,
      name,
      city,
      capacity,
    })),
  }));
}

/** A missing `feeMinor` is withheld from this role; `null` is no fee agreed (FR-6). */
function feeOf(booking: BookingWire): Fee {
  if (!('feeMinor' in booking) || booking.feeMinor === undefined) return { isShown: false };
  return {
    isShown: true,
    amountMinor: booking.feeMinor,
    currency: booking.feeCurrency ?? FEE_CURRENCY,
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
      email: booking.vendor.email ?? null,
      phone: booking.vendor.phone ?? null,
    },
    status: statusOf(booking.status),
    scopes: inSectionOrder(booking.briefScopes),
    fee: feeOf(booking),
    link: linkOf(booking),
  }));
}
