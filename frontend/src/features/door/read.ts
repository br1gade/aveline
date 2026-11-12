import type {
  AdmitWire,
  ArrivalCounts,
  ArrivalsWire,
  CheckInWire,
  DoorAdmission,
  DoorAnswer,
  DoorArrival,
  DoorGuest,
  DoorHousehold,
  DoorRosterWire,
  DoorSeat,
} from './types';

/**
 * Where the door's answers arrive. Every object is built by naming its fields, never by spreading
 * the response, so the code `admit` echoes back stops here: it is never kept, rendered or logged.
 */
function seatsOf(wire: CheckInWire): DoorSeat[] {
  if (wire.seating) return wire.seating.map(({ table, venue }) => ({ table, venue }));
  return wire.table ? [{ table: wire.table, venue: null }] : [];
}

export function readArrival(wire: CheckInWire): DoorArrival {
  return {
    guestId: wire.guestId,
    name: wire.name,
    arrivedAt: wire.arrivedAt,
    seats: seatsOf(wire),
    wasExpected: wire.wasExpected,
  };
}

export function readAdmission(wire: AdmitWire): DoorAdmission {
  return {
    admittedAt: wire.admittedAt,
    holderName: wire.holderName,
    guestId: wire.guestId ?? null,
  };
}

const ANSWERS: ReadonlySet<string> = new Set(['ATTENDING', 'DECLINED', 'UNDECIDED', 'PENDING']);

/**
 * A roster row by its named fields: anything else a row carries goes no further (FR-79). The
 * roster keeps someone erased in their household, marked, so the door leaves them out of its
 * results and doesn't wait for their agreement (FR-141).
 */
function readRosterGuest(wire: DoorRosterWire['items'][number]): DoorGuest {
  return {
    id: wire.guestId,
    name: wire.name,
    householdName: wire.householdName,
    answer: ANSWERS.has(wire.attendance) ? wire.attendance : ('PENDING' satisfies DoorAnswer),
    arrivedAt: wire.arrivedAt ?? null,
    seats: wire.seating.map(({ table, venue }) => ({ table, venue: venue ?? null })),
    isErased: wire.isErased,
  };
}

export function readRoster(wire: DoorRosterWire): {
  guests: DoorGuest[];
  nextCursor: string | null;
} {
  return { guests: wire.items.map(readRosterGuest), nextCursor: wire.nextCursor ?? null };
}

/** The roster's people grouped by their household's name, in the order they came. */
export function householdsOf(guests: readonly DoorGuest[]): DoorHousehold[] {
  const byName = new Map<string, DoorGuest[]>();
  for (const guest of guests) {
    const members = byName.get(guest.householdName);
    if (members) members.push(guest);
    else byName.set(guest.householdName, [guest]);
  }
  return [...byName].map(([name, members]) => ({ name, guests: members }));
}

export function readCounts(wire: ArrivalsWire): ArrivalCounts {
  return {
    expected: wire.expected,
    arrived: wire.arrived,
    stillToCome: wire.stillToCome,
    unexpected: wire.unexpected,
    recent: wire.recent.map(({ name, arrivedAt }) => ({ name, arrivedAt })),
  };
}
