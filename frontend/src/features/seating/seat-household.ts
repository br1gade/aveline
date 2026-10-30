/** What seating several guests one at a time came to. */
export interface SeatOutcome {
  seated: string[];
  /** The guest refused and everyone after them; nothing more was sent. */
  notSeated: string[];
  /** The refusal that stopped it; `null` when everyone was seated. */
  error: unknown;
}

/**
 * Seats a household's guests one request at a time, in order, and stops at the first refusal, so
 * nobody is put elsewhere once the table filled. **A temporary stand-in** under FR-53: the API seats
 * one guest per request, so a refusal partway leaves the household split until the host acts, and
 * the page says who was seated. Deleted when the backend seats a household in one request.
 */
export async function seatOneByOne(
  guestIds: readonly string[],
  seat: (guestId: string) => Promise<void>,
): Promise<SeatOutcome> {
  const seated: string[] = [];
  for (const [index, guestId] of guestIds.entries()) {
    try {
      await seat(guestId);
      seated.push(guestId);
    } catch (error) {
      return { seated, notSeated: guestIds.slice(index), error };
    }
  }
  return { seated, notSeated: [], error: null };
}
