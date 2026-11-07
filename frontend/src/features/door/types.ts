/**
 * What the door's calls return (docs/API.md §6: "Check-in on the day", "Admitting a ticket at the
 * door"). Interim until FR-1: the schema declares no response types, so these are written from the
 * guide and the backend's `check-in.service.ts` and `ticketing.service.ts`.
 *
 * The `…Wire` types say what arrives and are read by `read.ts` alone. It builds the client's own
 * objects field by field, so the code `admit` echoes back goes no further.
 */
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
