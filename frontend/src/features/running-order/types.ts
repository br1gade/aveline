/**
 * What the running-order calls return (docs/API.md §6, "The running order"). These are checked
 * against the schema at each call (FR-1), written from `timeline.service.ts`.
 */

/** An entry as `GET /events/:eventId/timeline` lists it, by `occursAt` then `sortOrder`. */
export interface TimelineEntryWire {
  id: string;
  label: unknown;
  occursAt: string;
  sortOrder: number;
  isInternal: boolean;
  /** The venue's own name, not translated. Writes return `venueId` instead (FR-94). */
  venue: { id: string; name: string } | null;
}

export interface TimelineEntry {
  id: string;
  /** One string per language; blank ones dropped. */
  label: Record<string, string>;
  occursAt: string;
  sortOrder: number;
  /** For the people running the day: off the invitation, still in the vendors' brief. */
  isInternal: boolean;
  venueId: string | null;
  venueName: string | null;
}

/** A venue as the event's detail carries it. */
export interface OrderVenue {
  id: string;
  role: string;
  name: string;
}
