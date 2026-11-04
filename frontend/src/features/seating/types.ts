/**
 * What the seating calls return (docs/API.md §6, "Tables and seating"). Interim until FR-1: the
 * schema declares no response types, so these are written from the guide and the backend's
 * services (`seating.service.ts`, `seating-jobs.service.ts`, `localized-seating.ts`), and only the
 * fields the page reads are typed. `read.ts` alone reads the `…Wire` types.
 */

/** One seating plan: a venue's, or the event's plan that names no venue. */
export interface Arrangement {
  id: string;
  /** `null` for the plan that names no venue. */
  venueId: string | null;
  /** The venue's own name, as the host typed it. */
  venueName: string | null;
  /** Set on the venue; `null` when none is. */
  venueCapacity: number | null;
  /** Raised by the server on every change that bears on seating. */
  revision: number;
  tableCount: number;
}

export interface SeatedGuest {
  guestId: string;
  name: string;
  /** A numbered chair, for printed cards; `null` when none is. */
  position: number | null;
  /** Held for them while they have not said they are coming there (design PD-54). */
  isReservation: boolean;
}

/** A seat a decline freed, kept on the table until the host seats them again or dismisses it. */
export interface ReleasedSeat {
  guestId: string;
  name: string;
  /** ISO 8601 UTC; shown in the event's zone. */
  releasedAt: string;
}

/** What the plan can draw; one the client doesn't know is drawn round. */
export type TableShape = 'round' | 'rectangle' | 'square' | 'oval';

export interface SeatingTable {
  id: string;
  arrangementId: string;
  name: string;
  capacity: number;
  zone: string | null;
  /** Its place on the drawn plan, in CSS pixels (design PD-135); `null` until placed. */
  posX: number | null;
  posY: number | null;
  shape: TableShape;
  guests: SeatedGuest[];
  released: ReleasedSeat[];
}

export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** A household automatic seating could not place, with why. */
export interface UnseatedHousehold {
  householdId: string;
  size: number;
  /** The planner's own sentence, in English (docs/API.md §1). */
  reason: string;
  /** The display code beside it, such as `SEATING_TABLES_FULL`; `null` from an older result. */
  code: string | null;
  /** The backend's sentence for that code, in the language asked for. */
  message: string | null;
}

export interface JobResult {
  seated: number;
  households: number;
  unseated: UnseatedHousehold[];
}

/** One automatic seating run. History summaries carry no `result`. */
export interface SeatingJob {
  id: string;
  arrangementId: string;
  status: JobStatus;
  /** Attempts started, at most three, crash recovery included. */
  attempts: number;
  /** A stable code, such as `STATE_CHANGED`; `null` without a failure. */
  failureReason: string | null;
  /** The backend's sentence for it, in the language asked for. */
  recoveryMessage: string | null;
  /** The plan's revision once the seats were applied; compared with the plan's own. */
  appliedRevision: number | null;
  createdAt: string;
  completedAt: string | null;
  result: JobResult | null;
}

export interface ArrangementWire {
  id: string;
  venueId: string | null;
  revision: number;
  venue: { name: string; capacity: number | null } | null;
  _count?: { tables?: number };
}

export interface SeatedWire {
  guestId: string;
  name: string;
  position: number | null;
  isReservation?: boolean;
}

export interface ReleasedWire {
  guestId: string;
  name: string;
  releasedAt: string;
}

export interface TableWire {
  id: string;
  arrangementId: string;
  name: string;
  capacity: number;
  zone: string | null;
  posX?: number | null;
  posY?: number | null;
  shape?: string | null;
  guests: SeatedWire[];
  released?: ReleasedWire[];
}

export interface ExplanationWire {
  code?: unknown;
  userMessage?: unknown;
}

export interface UnseatedWire {
  householdId: string;
  size: number;
  reason: string;
  explanation?: ExplanationWire | null;
}

export interface ResultWire {
  seated?: number;
  households?: number;
  unseated?: UnseatedWire[];
}

export interface JobWire {
  id: string;
  arrangementId: string;
  status: string;
  attempts: number;
  failureReason: string | null;
  recovery?: { userMessage?: unknown } | null;
  appliedRevision: number | null;
  createdAt: string;
  completedAt: string | null;
  result?: ResultWire | null;
}

/** `POST /seating/publish` and `/unpublish`. */
export interface PublishedWire {
  seatingPublishedAt: string | null;
}
