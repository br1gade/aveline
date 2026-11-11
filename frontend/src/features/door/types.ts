/**
 * What the door's calls return (docs/API.md §6: "Check-in on the day", "Admitting a ticket at the
 * door"). These are checked against the schema at each call (FR-1), written from the
 * guide and the backend's `check-in.service.ts` and `ticketing.service.ts`.
 *
 * The `…Wire` types say what arrives and are read by `read.ts` alone. It builds the client's own
 * objects field by field, so the code `admit` echoes back goes no further.
 */
import type { components } from '@/api/schema';

/** The roster's answer, as the generated schema declares it (docs/API.md §6, "Door roster"). */
export type DoorRosterWire = components['schemas']['DoorRosterDto'];
type DoorGuestWire = components['schemas']['DoorGuestDto'];
export type DoorAnswer = DoorGuestWire['attendance'];

/**
 * One person as the door holds them (FR-79). The roster carries no token, contact or ticket code,
 * and its reader keeps only these fields.
 */
export interface DoorGuest {
  id: string;
  name: string;
  /** The door shows a household by its name; the roster names no household id. */
  householdName: string;
  answer: DoorAnswer;
  /** When they arrived, in UTC; `null` until they do. */
  arrivedAt: string | null;
  seats: DoorSeat[];
  /** Erased at their request: never offered at the door (FR-141, a stand-in in `read.ts`). */
  isErased: boolean;
}

/** People who share a household's name, who usually arrive together. */
export interface DoorHousehold {
  name: string;
  guests: DoorGuest[];
}

export interface SeatWire {
  venue: string | null;
  table: string;
}

export interface CheckInWire {
  guestId: string;
  name: string;
  arrivedAt: string;
  table: string | null;
  seating?: SeatWire[];
  wasExpected: boolean;
}

export interface AdmitWire {
  code?: string;
  admittedAt: string;
  holderName: string | null;
  /** `null` for a legacy ticket nobody is linked to. */
  guestId: string | null;
}

export interface ArrivalsWire {
  expected: number;
  arrived: number;
  stillToCome: number;
  unexpected: number;
  recent: Array<{ name: string; arrivedAt: string }>;
}

/** A table to point at, at its venue when the plan names one. */
export interface DoorSeat {
  table: string;
  venue: string | null;
}

export interface DoorArrival {
  guestId: string;
  name: string;
  arrivedAt: string;
  seats: DoorSeat[];
  wasExpected: boolean;
}

export interface DoorAdmission {
  admittedAt: string;
  holderName: string | null;
  guestId: string | null;
}

export type ArrivalCounts = ArrivalsWire;
