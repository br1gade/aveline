import { isApiError } from '@/api/errors';

import type {
  Brief,
  BriefSection,
  BriefVenue,
  BriefVenueWire,
  BriefWire,
  GrantedSection,
  HeadcountWire,
  SeatingWire,
} from './types';

function countsOf<
  T extends {
    invited: number;
    attending: number;
    declined: number;
    undecided: number;
    pending: number;
  },
>(counts: T) {
  const { invited, attending, declined, undecided, pending } = counts;
  return { invited, attending, declined, undecided, pending };
}

function headcountOf(wire: HeadcountWire) {
  return {
    ...countsOf(wire),
    households: wire.households,
    responseRate: wire.responseRate,
    bySide: wire.bySide.map((side) => ({ side: side.side, ...countsOf(side) })),
    venues: wire.venues.map((venue) => ({ venue: venue.venue, ...countsOf(venue) })),
  };
}

function seatingOf(wire: SeatingWire) {
  return wire.map((table) => ({
    name: table.name,
    capacity: table.capacity,
    zone: table.zone,
    venue: table.venue,
    seated: table.seated,
    guests: table.guests.map((guest) => guest.name),
    freed: table.released.length,
  }));
}

/**
 * One reader per section the client has words for, each naming every field it keeps. The keys are
 * the schema's sections, so a section the backend adds fails the typecheck until it is read here.
 */
const SECTION_READERS: { [S in BriefSection]: (wire: BriefWire) => GrantedSection | null } = {
  headcount: ({ headcount }) =>
    headcount ? { section: 'headcount', data: headcountOf(headcount) } : null,
  catering: ({ catering }) =>
    catering
      ? {
          section: 'catering',
          data: {
            covers: catering.covers,
            requirements: catering.requirements.map(({ requirement, count }) => ({
              requirement,
              count,
            })),
            notes: catering.notes.map(({ guest, household, note }) => ({ guest, household, note })),
          },
        }
      : null,
  bar: ({ bar }) =>
    bar
      ? {
          section: 'bar',
          data: {
            totalResponses: bar.totalResponses,
            preferences: bar.preferences.map(({ drink, guests }) => ({ drink, guests })),
          },
        }
      : null,
  playlist: ({ playlist }) =>
    playlist
      ? {
          section: 'playlist',
          data: { tracks: playlist.tracks.map(({ track, requests }) => ({ track, requests })) },
        }
      : null,
  timeline: ({ timeline }) =>
    timeline
      ? {
          section: 'timeline',
          data: timeline.map((entry) => ({
            label: entry.label ?? null,
            occursAt: entry.occursAt,
            venue: entry.venue,
          })),
        }
      : null,
  seating: ({ seating }) => (seating ? { section: 'seating', data: seatingOf(seating) } : null),
  households: ({ households }) =>
    households
      ? {
          section: 'households',
          data: households.map(({ household, guests }) => ({ household, guests: [...guests] })),
        }
      : null,
  contacts: ({ contacts }) =>
    contacts
      ? {
          section: 'contacts',
          data: contacts.map(({ name, email, phone }) => ({ name, email, phone })),
        }
      : null,
};

function isKnownSection(section: string): section is BriefSection {
  return Object.hasOwn(SECTION_READERS, section);
}

/** Only an http or https link opens from the page; the backend checks this on writing, too. */
function safeMapUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

function venueOf(venue: BriefVenueWire): BriefVenue {
  return {
    role: venue.role,
    name: venue.name,
    address: venue.address,
    arriveAt: venue.arriveAt,
    mapUrl: safeMapUrl(venue.mapUrl),
  };
}

/**
 * Exactly what the booking granted, in its order (docs/API.md: "Render from `granted` rather than
 * probing for keys"). A section the client has no words for, or one the answer left out, is shown
 * by the backend's purpose alone, never by guessing at what is inside it.
 */
export function readBrief(wire: BriefWire): Brief {
  return {
    vendor: { name: wire.vendor.name },
    status: wire.status,
    event: {
      title: wire.event.title,
      startsAt: wire.event.startsAt,
      endsAt: wire.event.endsAt,
      timezone: wire.event.timezone,
      venues: wire.event.venues.map(venueOf),
    },
    sections: wire.granted.map(
      ({ section, purpose }) =>
        (isKnownSection(section) ? SECTION_READERS[section](wire) : null) ?? {
          section: 'unknown',
          key: section,
          purpose,
        },
    ),
  };
}

export type BriefFailure =
  /** Not a link, or one replaced since: a new one may have been sent (404). */
  | { kind: 'gone' }
  /** The engagement was ended (403). */
  | { kind: 'ended' }
  | { kind: 'rateLimited' }
  | { kind: 'failed'; requestId?: string | undefined };

/**
 * Read inside an effect, where no error boundary catches a throw: an answer that isn't what the
 * reader expects is a failure the page words, never a page stuck loading.
 */
export function briefFailureOf(error: unknown): BriefFailure {
  if (!isApiError(error)) return { kind: 'failed' };
  if (error.status === 404) return { kind: 'gone' };
  if (error.status === 403) return { kind: 'ended' };
  if (error.status === 429) return { kind: 'rateLimited' };
  return { kind: 'failed', requestId: error.requestId };
}
