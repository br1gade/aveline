import type { BookingStatus, BriefSection, VendorCategory } from './types';

/** What a brief can hold, in the backend's order (`vendor-brief.ts`, `BRIEF_SECTIONS`). */
export const BRIEF_SECTIONS = [
  'headcount',
  'catering',
  'bar',
  'playlist',
  'timeline',
  'seating',
  'households',
  'contacts',
] as const satisfies readonly BriefSection[];

/** Every kind of vendor, in the order the pages offer them; the record makes the list whole. */
const CATEGORY_ORDER = {
  VENUE: true,
  CATERING: true,
  BAR: true,
  DECOR: true,
  PHOTOGRAPHY: true,
  VIDEOGRAPHY: true,
  MUSIC: true,
  PRINT: true,
  OTHER: true,
} as const satisfies Record<VendorCategory, true>;

export const VENDOR_CATEGORIES = Object.keys(CATEGORY_ORDER) as VendorCategory[];

/** The statuses a booking can be moved to by hand; ending it is its own, asked-first action. */
export const CHOOSABLE_STATUSES = [
  'ENQUIRED',
  'QUOTED',
  'CONFIRMED',
  'COMPLETED',
] as const satisfies readonly BookingStatus[];

const ALL_STATUSES: readonly string[] = [...CHOOSABLE_STATUSES, 'CANCELLED'];

export function isVendorCategory(value: string): value is VendorCategory {
  return Object.hasOwn(CATEGORY_ORDER, value);
}

export function isBookingStatus(value: string): value is BookingStatus {
  return ALL_STATUSES.includes(value);
}

/** The sections ticked, in the backend's order and once each; anything else is dropped. */
export function inSectionOrder(sections: readonly string[]): BriefSection[] {
  const ticked = new Set(sections);
  return BRIEF_SECTIONS.filter((section) => ticked.has(section));
}
