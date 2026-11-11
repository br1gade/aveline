import type { components } from '@/api/schema';

/**
 * A vendor's brief (docs/API.md §6, "Vendors and scoped briefs"). Interim until FR-1: written from
 * `vendor-briefs.service.ts`, `operations.service.ts` and `seating.service.ts` at `34ac1e6`.
 * `read.ts` alone reads the `…Wire` types. The answer names no language (FR-104): its words are
 * the event's default language's, which the page can't say.
 */

export type BriefSection = NonNullable<
  components['schemas']['BookVendorDto']['briefScopes']
>[number];

interface Counts {
  invited: number;
  attending: number;
  declined: number;
  undecided: number;
  pending: number;
}

export interface HeadcountWire extends Counts {
  households: number;
  responseRate: number;
  bySide: Array<Counts & { side: string }>;
  venues: Array<Counts & { venue: string }>;
}

export interface CateringWire {
  covers: number;
  requirements: Array<{ requirement: string; count: number }>;
  notes: Array<{ guest: string; household: string; note: string }>;
}

export interface BarWire {
  totalResponses: number;
  preferences: Array<{ drink: string; guests: number }>;
}

export interface PlaylistWire {
  tracks: Array<{ track: string; requests: number }>;
}

export type TimelineWire = Array<{ label?: string | null; occursAt: string; venue: string | null }>;

export type SeatingWire = Array<{
  name: string;
  capacity: number;
  zone: string | null;
  venue: string | null;
  seated: number;
  guests: Array<{ name: string; position: number | null }>;
  /** How many seats someone who declined left free; never who (FR-107, design PD-125). */
  releasedCount: number;
}>;

export type HouseholdsWire = Array<{ household: string; guests: string[] }>;

export type ContactsWire = Array<{ name: string; email: string | null; phone: string | null }>;

export interface BriefVenueWire {
  role: string;
  name: string;
  address: string;
  arriveAt: string | null;
  mapUrl: string | null;
}

export interface BriefWire {
  vendor: { name: string; category: string };
  status: string;
  event: {
    title: string;
    startsAt: string;
    endsAt: string | null;
    timezone: string;
    venues: BriefVenueWire[];
  };
  granted: Array<{ section: string; purpose: string }>;
  headcount?: HeadcountWire;
  catering?: CateringWire;
  bar?: BarWire;
  playlist?: PlaylistWire;
  timeline?: TimelineWire;
  seating?: SeatingWire;
  households?: HouseholdsWire;
  contacts?: ContactsWire;
}

/** The numbers, without the day-by-day `trend`, which is for a host deciding to chase (PD-125). */
export type Headcount = HeadcountWire;
export type Catering = CateringWire;
export type Bar = BarWire;
export type Playlist = PlaylistWire;
export type Timeline = Array<{ label: string | null; occursAt: string; venue: string | null }>;
/** Who sits where, and how many seats someone who declined left free, not who (design PD-125). */
export type Seating = Array<{
  name: string;
  capacity: number;
  zone: string | null;
  venue: string | null;
  seated: number;
  guests: string[];
  freed: number;
}>;
export type Households = HouseholdsWire;
export type Contacts = ContactsWire;

/** One granted section with what it holds, or one this client has no words for yet. */
export type GrantedSection =
  | { section: 'headcount'; data: Headcount }
  | { section: 'catering'; data: Catering }
  | { section: 'bar'; data: Bar }
  | { section: 'playlist'; data: Playlist }
  | { section: 'timeline'; data: Timeline }
  | { section: 'seating'; data: Seating }
  | { section: 'households'; data: Households }
  | { section: 'contacts'; data: Contacts }
  /** The backend's English purpose, shown marked as English, with nothing from inside it. */
  | { section: 'unknown'; key: string; purpose: string };

export interface BriefVenue {
  role: string;
  name: string;
  address: string;
  arriveAt: string | null;
  /** Only an http or https address; anything else is dropped. */
  mapUrl: string | null;
}

export interface Brief {
  vendor: { name: string };
  status: string;
  event: {
    title: string;
    startsAt: string;
    endsAt: string | null;
    timezone: string;
    venues: BriefVenue[];
  };
  /** In the order the backend granted them, which is its own fixed order. */
  sections: GrantedSection[];
}
