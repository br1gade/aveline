import type { components } from '@/api/schema';
import { minorToDecimalString, toMinor } from '@/lib/money';

import type { BookingEditValues, BookingFormValues, VendorFormValues } from './schemas';
import { inSectionOrder } from './scopes';
import type { Booking } from './types';

type Schemas = components['schemas'];

/** The backend stores every fee in AMD and takes no other (FR-106, design PD-123). */
export const FEE_CURRENCY = 'AMD';

export const NEW_VENDOR_VALUES: VendorFormValues = { name: '', category: '', email: '', phone: '' };

/** A vendor's details, trimmed; an empty one is left out rather than sent blank. */
export function newVendorPayload(values: {
  name: string;
  category: Schemas['CreateVendorDto']['category'];
  email: string;
  phone: string;
}): Schemas['CreateVendorDto'] {
  const email = values.email.trim();
  const phone = values.phone.trim();
  return {
    name: values.name.trim(),
    category: values.category,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
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
    ...(fee ? { feeMinor: toMinor(fee, FEE_CURRENCY) } : {}),
  };
}

/** The currency a booking's fee is typed in: its own, or AMD for a role not shown the fee. */
export function currencyOf(booking: Booking): string {
  return booking.fee.isShown ? booking.fee.currency : FEE_CURRENCY;
}

/** The form starts from the booking as it is. It isn't offered on an ended booking. */
export function bookingEditValues(booking: Booking): BookingEditValues {
  const { fee } = booking;
  return {
    status: booking.status === 'CANCELLED' ? 'ENQUIRED' : booking.status,
    scopes: [...booking.scopes],
    fee: fee.isShown && fee.amountMinor ? minorToDecimalString(fee.amountMinor, fee.currency) : '',
  };
}

function isSameSections(left: readonly string[], right: readonly string[]): boolean {
  const ordered = inSectionOrder(right);
  return (
    left.length === ordered.length && left.every((section, index) => section === ordered[index])
  );
}

/** The new fee, if it differs; never to a role that isn't shown the fee, which can't know it. */
function feeChange(booking: Booking, typed: string): string | undefined {
  if (!booking.fee.isShown || !typed.trim()) return undefined;
  const minor = toMinor(typed, currencyOf(booking));
  return minor === booking.fee.amountMinor ? undefined : minor;
}

/** Only what changed: omitted means "leave as is" (backend CLAUDE.md §6). */
export function bookingChanges(
  booking: Booking,
  values: BookingEditValues,
): Schemas['UpdateBookingDto'] {
  const feeMinor = feeChange(booking, values.fee);
  return {
    ...(values.status === booking.status ? {} : { status: values.status }),
    ...(isSameSections(booking.scopes, values.scopes)
      ? {}
      : { briefScopes: inSectionOrder(values.scopes) }),
    ...(feeMinor === undefined ? {} : { feeMinor }),
  };
}
