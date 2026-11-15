/** A seat the section read offers (docs/API.md, "Show ticket inventory"). */
export interface FreeSeat {
  id: string;
  row: string;
  label: string;
}

export interface SeatRow {
  row: string;
  seats: FreeSeat[];
}

/**
 * The free seats by row, rows and seats in the order the API gives them: that is the venue's layout
 * order, which no sort may change (design PD-201).
 */
export function seatRows(seats: readonly FreeSeat[]): SeatRow[] {
  const rows = new Map<string, FreeSeat[]>();
  for (const seat of seats) {
    const row = rows.get(seat.row);
    if (row) row.push(seat);
    else rows.set(seat.row, [seat]);
  }
  return Array.from(rows, ([row, inRow]) => ({ row, seats: inRow }));
}
