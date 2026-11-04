/** Interim until FR-1: read against `operations.service.ts` at `34ac1e6`. */
export interface CateringSheet {
  covers: number;
  /** Most asked for first; each label in the event's language. */
  requirements: { label: string; count: number }[];
  notes: { guest: string; household: string; note: string }[];
}

export interface BarSheet {
  totalResponses: number;
  preferences: { label: string; guests: number; share: number }[];
}

export interface Playlist {
  uniqueTracks: number;
  tracks: { track: string; requests: number }[];
}

export interface Engagement {
  totalViews: number;
  byLocale: { locale: string; views: number }[];
}

export interface SheetVenue {
  id: string;
  name: string;
}

export interface EventSheets {
  catering: CateringSheet;
  bar: BarSheet;
  playlist: Playlist;
  engagement: Engagement;
  /** The venues guests see, in the host's order. */
  venues: SheetVenue[];
}
