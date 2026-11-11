import type { components } from '@/api/schema';
import { minorToDecimalString, toMinor } from '@/lib/money';

import type { BookingEditValues, BookingFormValues, VendorFormValues } from './schemas';
import { inSectionOrder } from './scopes';
import type { Booking, Vendor } from './types';

type Schemas = components['schemas'];

/** A new booking's currency unless another is chosen, as the backend's (docs/API.md §6). */
export const DEFAULT_FEE_CURRENCY = 'AMD';

/**
 * The currencies a fee is offered in (FR-106, design PD-123). The backend takes any ISO 4217 code;
 * a booking already in another keeps its own beside these.
 */
export const FEE_CURRENCIES = ['AMD', 'USD', 'EUR', 'RUB', 'GEL', 'GBP'] as const;

export const NEW_VENDOR_VALUES: VendorFormValues = {
  name: '',
  category: '',
  email: '',
  phone: '',
  notes: '',
};

type VendorDetails = Omit<Schemas['CreateVendorDto'], 'email' | 'phone' | 'notes'> & {
  email: string;
  phone: string;
  notes: string;
};

/** A vendor's details, trimmed; an empty one is left out rather than sent blank. */
export function newVendorPayload(values: VendorDetails): Schemas['CreateVendorDto'] {
  const email = values.email.trim();
  const phone = values.phone.trim();
  const notes = values.notes.trim();
  return {
    name: values.name.trim(),
    category: values.category,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(notes ? { notes } : {}),
  };
}

/** The form starts from the vendor as it is. */
export function vendorEditValues(vendor: Vendor): VendorFormValues {
  return {
    name: vendor.name,
    category: vendor.category,
    email: vendor.email ?? '',
    phone: vendor.phone ?? '',
    notes: vendor.notes ?? '',
  };
}

/** A detail as it will be stored: an emptied one is `null`, which clears it (FR-102). */
function stored(typed: string): string | null {
  return typed.trim() || null;
}

/** Only what changed; omitted means "leave as is" (backend CLAUDE.md §6). */
export function vendorChanges(vendor: Vendor, values: VendorDetails): Schemas['UpdateVendorDto'] {
  const name = values.name.trim();
  const email = stored(values.email);
  const phone = stored(values.phone);
  const notes = stored(values.notes);
  return {
    ...(name === vendor.name ? {} : { name }),
    ...(values.category === vendor.category ? {} : { category: values.category }),
    ...(email === vendor.email ? {} : { email }),
    ...(phone === vendor.phone ? {} : { phone }),
    ...(notes === vendor.notes ? {} : { notes }),
  };
}

/**
 * The sections ticked are always sent, an empty list included, so what the host saw ticked is what
 * the vendor gets: the backend's category default never decides (design PD-121).
 */
export function bookingPayload(values: BookingFormValues): Schemas['BookVendorDto'] {
  const fee = values.fee.trim();
  return {
    vendorId: values.vendorId,
    briefScopes: inSectionOrder(values.scopes),
    ...(fee ? { feeMinor: toMinor(fee, values.currency), feeCurrency: values.currency } : {}),
  };
}

/** The currency a booking's fee is typed in: its own, or the default for a role not shown it. */
export function currencyOf(booking: Booking): string {
  return booking.fee.isShown ? booking.fee.currency : DEFAULT_FEE_CURRENCY;
}

/** The form starts from the booking as it is. It isn't offered on an ended booking. */
export function bookingEditValues(booking: Booking): BookingEditValues {
  const { fee } = booking;
  return {
    status: booking.status === 'CANCELLED' ? 'ENQUIRED' : booking.status,
    scopes: [...booking.scopes],
    fee: fee.isShown && fee.amountMinor ? minorToDecimalString(fee.amountMinor, fee.currency) : '',
    currency: currencyOf(booking),
  };
}

function isSameSections(left: readonly string[], right: readonly string[]): boolean {
  const ordered = inSectionOrder(right);
  return (
    left.length === ordered.length && left.every((section, index) => section === ordered[index])
  );
}

/**
 * The fee's change (FR-106): an emptied field clears it with `null`, and a new currency always goes
 * with the amount, as the backend asks. Never sent for a role that isn't shown the fee.
 */
function feeChanges(booking: Booking, values: BookingEditValues): Schemas['UpdateBookingDto'] {
  if (!booking.fee.isShown) return {};
  const typed = values.fee.trim();
  const feeMinor = typed ? toMinor(typed, values.currency) : null;
  if (values.currency !== booking.fee.currency) {
    return { feeMinor, feeCurrency: values.currency };
  }
  return feeMinor === booking.fee.amountMinor ? {} : { feeMinor };
}

/** Only what changed: omitted means "leave as is" (backend CLAUDE.md §6). */
export function bookingChanges(
  booking: Booking,
  values: BookingEditValues,
): Schemas['UpdateBookingDto'] {
  return {
    ...(values.status === booking.status ? {} : { status: values.status }),
    ...(isSameSections(booking.scopes, values.scopes)
      ? {}
      : { briefScopes: inSectionOrder(values.scopes) }),
    ...feeChanges(booking, values),
  };
}
