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

/**
 * The usual sections for each kind of vendor, which the booking form ticks to start with.
 * **A temporary stand-in (design PD-121):** the backend does not expose its `SUGGESTED_SCOPES`
 * (FR-105), so this copy is pinned to it by a test that reads `vendor-brief.ts`. The form always
 * sends what is ticked, so the backend's own default never decides. Deleted when FR-105 is answered.
 * The keys are also the categories, in the order the pages offer them.
 */
export const USUAL_SECTIONS = {
  VENUE: ['headcount', 'seating', 'timeline'],
  CATERING: ['headcount', 'catering', 'timeline'],
  BAR: ['headcount', 'bar', 'timeline'],
  DECOR: ['seating', 'timeline'],
  PHOTOGRAPHY: ['timeline', 'households'],
  VIDEOGRAPHY: ['timeline', 'households'],
  MUSIC: ['playlist', 'timeline'],
  PRINT: ['households'],
  OTHER: ['timeline'],
} as const satisfies Record<VendorCategory, readonly BriefSection[]>;

export const VENDOR_CATEGORIES = Object.keys(USUAL_SECTIONS) as VendorCategory[];

/** The statuses a booking can be moved to by hand; ending it is its own, asked-first action. */
export const CHOOSABLE_STATUSES = [
  'ENQUIRED',
  'QUOTED',
  'CONFIRMED',
  'COMPLETED',
] as const satisfies readonly BookingStatus[];

const ALL_STATUSES: readonly string[] = [...CHOOSABLE_STATUSES, 'CANCELLED'];

export function isVendorCategory(value: string): value is VendorCategory {
  return Object.hasOwn(USUAL_SECTIONS, value);
}

export function isBookingStatus(value: string): value is BookingStatus {
  return ALL_STATUSES.includes(value);
}

/** The sections ticked, in the backend's order and once each; anything else is dropped. */
export function inSectionOrder(sections: readonly string[]): BriefSection[] {
  const ticked = new Set(sections);
  return BRIEF_SECTIONS.filter((section) => ticked.has(section));
}

export function usualSectionsFor(category: VendorCategory): BriefSection[] {
  return [...USUAL_SECTIONS[category]];
}
