import type { ResponseOf } from '@/api/client';
import type { components } from '@/api/schema';

/**
 * What the vendor calls return (docs/API.md §6, "Vendors and scoped briefs"), from the schema
 * (FR-1). `read.ts` alone reads the `…Wire` types.
 */

type Schemas = components['schemas'];

export type VendorCategory = Schemas['VendorCategory'];
export type BookingStatus = NonNullable<Schemas['UpdateBookingDto']['status']>;
export type BriefSection = NonNullable<Schemas['BookVendorDto']['briefScopes']>[number];

export type VendorWire = ResponseOf<'VendorsController_listVendorsResponse'>[number];
export type BookingWire = ResponseOf<'VendorsController_listBookingsResponse'>[number];
export type VendorOptionsWire = Schemas['VendorOptionsDto'];

/** A hall in the shared directory that a curated venue vendor runs; hosts read it only. */
export interface Hall {
  id: string;
  name: string;
  city: string | null;
  capacity: number | null;
}

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  email: string | null;
  phone: string | null;
  /** The organization's own notes, given only to a role that may edit vendors (FR-102). */
  notes: string | null;
  /** Aveline's own list, which every organization sees; otherwise this organization's. */
  isCurated: boolean;
  halls: Hall[];
}

/** One vendor a booking can be made with: no contacts, notes or fees (FR-103). */
export interface VendorChoice {
  id: string;
  name: string;
  category: VendorCategory;
  isCurated: boolean;
}

export interface VendorChoices {
  choices: VendorChoice[];
  /** The sections the backend gives each kind of vendor when none are chosen (FR-105). */
  usualSections: ReadonlyMap<VendorCategory, BriefSection[]>;
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
  /** False while the host has paused the brief: its link opens nothing (FR-108, C-56). */
  isBriefEnabled: boolean;
}
