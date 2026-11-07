import type { components } from '@/api/schema';

/**
 * What the vendor calls return (docs/API.md §6, "Vendors and scoped briefs"). Interim until FR-1:
 * written from `vendors.service.ts` at `34ac1e6`. `read.ts` alone reads the `…Wire` types.
 */

type Schemas = components['schemas'];

export type VendorCategory = Schemas['CreateVendorDto']['category'];
export type BookingStatus = NonNullable<Schemas['UpdateBookingDto']['status']>;
export type BriefSection = NonNullable<Schemas['BookVendorDto']['briefScopes']>[number];

/** A hall in the shared directory that a curated venue vendor runs; hosts read it only. */
export interface Hall {
  id: string;
  name: string;
  city: string | null;
  capacity: number | null;
}

export interface VendorWire {
  id: string;
  name: string;
  category: string;
  email: string | null;
  phone: string | null;
  isCurated: boolean;
  venueProfiles?: Hall[];
}

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  email: string | null;
  phone: string | null;
  /** Aveline's own list, which every organization sees; otherwise this organization's. */
  isCurated: boolean;
  halls: Hall[];
}

export interface BookingWire {
  id: string;
  vendor: {
    id: string;
    name: string;
    category: string;
    email?: string | null;
    phone?: string | null;
  };
  status: string;
  briefScopes: string[];
  /** Absent without `vendor:write`: the link is a credential. */
  briefToken?: string;
  /** Absent without `vendor:fee:read`; `null` when no fee is agreed. */
  feeMinor?: string | null;
  feeCurrency?: string;
}

/** The agreed fee, which a role without `vendor:fee:read` is not shown (FR-6). */
export type Fee =
  { isShown: false } | { isShown: true; amountMinor: string | null; currency: string };

/** The brief's link, which only a role with `vendor:write` is given. Never rendered or logged. */
export type BriefLink = { isShown: false } | { isShown: true; token: string };

export interface Booking {
  id: string;
  vendor: {
    id: string;
    name: string;
    category: VendorCategory;
    email: string | null;
    phone: string | null;
  };
  status: BookingStatus;
  scopes: BriefSection[];
  fee: Fee;
  link: BriefLink;
}
