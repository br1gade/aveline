import type { BlockMedia, QuestionType, RsvpFieldConfig } from '@/features/invitation-renderer';

import type { SaleLimits } from './basket';

/**
 * `GET /public/events/:slug` (docs/API.md §5), interim until FR-1. Translated values are already
 * in the response's `locale`; `null` where the host gave none.
 */
export type AttendanceMode = 'EVENT_WIDE' | 'PER_VENUE';

export interface PublicTicketType extends SaleLimits {
  name: string | null;
  description: string | null;
  /** Minor units as a string; `"0"` is free (docs/API.md §1). */
  priceMinor: string;
  currency: string;
  /** `salesStartAt` is not given (FR-66): a type not yet on sale looks buyable until checkout refuses it. */
  salesEndAt: string | null;
}

export interface PublicVenue {
  id: string;
  /** As the host stored it: not translated (FR-65). */
  name: string;
  address: string | null;
}

export interface CheckoutQuestion {
  id: string;
  type: QuestionType;
  required: boolean;
  prompt: string | null;
  options: string[];
}

/** A statement each ticket holder is asked to agree to by email, before the door. */
export interface AgreementBeforeDoor {
  questionId: string;
  prompt: string | null;
}

/** What checkout asks of each person (docs/API.md §5, "Buying tickets"). */
export interface CheckoutRules {
  attendanceMode: AttendanceMode;
  attendanceRevision: number;
  /** The venues guests see, each answered on its own in PER_VENUE. */
  venues: Array<{ id: string; name: string }>;
  dietary: RsvpFieldConfig;
  drink: RsvpFieldConfig;
  /** The host's questions, SIGNATURE left out by the backend. */
  questions: CheckoutQuestion[];
  agreementsBeforeDoor: AgreementBeforeDoor[];
}

/** For `<head>`, used verbatim (docs/API.md §5). */
export interface EventMetadata {
  title: string | null;
  description: string | null;
  image: BlockMedia | null;
  locale: string;
  alternateLocales: string[];
  canonicalPath: string;
  robots: string;
}

export interface TicketSection {
  key: string;
  name: string;
  mode: 'NUMBERED' | 'UNNUMBERED';
  ticketTypeIds: string[];
}

export interface PublicEvent {
  ticketInventory?: { layoutVersionId: string; sections: TicketSection[] } | null;
  slug: string;
  locale: string;
  availableLocales: string[];
  headline: string | null;
  summary: string | null;
  body: string | null;
  heroImage: BlockMedia | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  venues: PublicVenue[];
  ticketTypes: PublicTicketType[];
  checkout: CheckoutRules;
  metadata: EventMetadata;
}

/**
 * A card from browsing public events (docs/API.md §5). Its `startsAt` is not kept: the answer gives
 * no zone to show it in (FR-92), and its words are in a language it does not name (FR-92), so a card
 * can't mark them either.
 */
export interface ListingCard {
  slug: string;
  headline: string | null;
  summary: string | null;
  categories: string[];
  heroImage: BlockMedia | null;
  /** The first venue guests see, as stored. */
  venue: string | null;
  /** The cheapest active ticket type, sold out or not (FR-93); `null` with none. */
  fromPriceMinor: string | null;
  currency: string | null;
}

export interface PublicListing {
  cards: ListingCard[];
  limit: number;
  hasMore: boolean;
}
