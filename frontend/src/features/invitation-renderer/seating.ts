import type { InvitationGuest, SeatAssignment } from './types';

/** One seat as the personal card says it. */
export interface TableLine {
  venue: string | null;
  table: string;
  isReservation: boolean;
}

export interface YourTables {
  own: TableLine[];
  /** Household members, by name, only where they sit apart from the guest. */
  others: Array<{ name: string; seats: TableLine[] }>;
}

type Seating = NonNullable<InvitationGuest['seating']>;

function lineOf({ venue, table, isReservation }: SeatAssignment): TableLine {
  return { venue, table, isReservation };
}

/** A person's seats; an older answer gives one `table` and no array. */
function seatsOf(person: {
  table: string | null;
  assignments?: SeatAssignment[];
}): SeatAssignment[] {
  if (person.assignments) return person.assignments;
  return person.table
    ? [{ venueId: null, venue: null, table: person.table, isReservation: false }]
    : [];
}

/** In the host's venue order, as the guest's own answers list it; a seat without a venue last. */
function inVenueOrder(seats: SeatAssignment[], guest: InvitationGuest): SeatAssignment[] {
  const order = (guest.attendance?.venues ?? []).map((venue) => venue.venueId);
  const rank = (seat: SeatAssignment) => {
    const position = seat.venueId === null ? -1 : order.indexOf(seat.venueId);
    return position === -1 ? order.length : position;
  };
  return [...seats].sort((a, b) => rank(a) - rank(b));
}

function apartFrom(own: readonly SeatAssignment[]) {
  return (seat: SeatAssignment) =>
    !own.some((mine) => mine.venueId === seat.venueId && mine.table === seat.table);
}

/**
 * The guest's own tables and where the rest of their household sits apart from them (design
 * PD-71), from `guest.seating`, which carries their own household only and is `null` until the
 * hosts publish the seating. Nothing to say is `null`: the page shows nothing rather than "no
 * table" (docs/API.md §4).
 */
export function yourTables(guest: InvitationGuest): YourTables | null {
  const seating: Seating | null | undefined = guest.seating;
  if (!seating) return null;
  const own = inVenueOrder(seatsOf(seating), guest);
  const others = seating.household
    .filter((member) => member.id !== guest.id)
    .map((member) => ({
      name: member.name,
      seats: inVenueOrder(seatsOf(member), guest).filter(apartFrom(own)).map(lineOf),
    }))
    .filter((member) => member.seats.length > 0);
  if (own.length === 0 && others.length === 0) return null;
  return { own: own.map(lineOf), others };
}
