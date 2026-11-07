import type {
  AdmitWire,
  ArrivalCounts,
  ArrivalsWire,
  CheckInWire,
  DoorAdmission,
  DoorArrival,
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

export function readCounts(wire: ArrivalsWire): ArrivalCounts {
  return {
    expected: wire.expected,
    arrived: wire.arrived,
    stillToCome: wire.stillToCome,
    unexpected: wire.unexpected,
    recent: wire.recent.map(({ name, arrivedAt }) => ({ name, arrivedAt })),
  };
}
