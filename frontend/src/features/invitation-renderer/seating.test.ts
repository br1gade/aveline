import { describe, expect, it } from 'vitest';

import { yourTables } from './seating';
import type { InvitationGuest, SeatAssignment } from './types';

function seat(table: string, venueId: string | null, overrides: Partial<SeatAssignment> = {}) {
  return {
    arrangementId: `a-${venueId ?? 'none'}`,
    venueId,
    venue: venueId ? `Venue ${venueId}` : null,
    tableId: `t-${table}`,
    table,
    position: null,
    isReservation: false,
    ...overrides,
  };
}

function guest(
  seating: InvitationGuest['seating'] | undefined,
  venues: string[] = [],
): InvitationGuest {
  return {
    id: 'g1',
    name: 'Armen Petrosyan',
    locale: 'hy',
    household: { name: 'Petrosyan family', seatsAllotted: 2, members: [] },
    rsvp: null,
    attendance: {
      mode: 'PER_VENUE',
      revision: 2,
      status: 'ATTENDING',
      needsReconfirmation: false,
      venues: venues.map((venueId) => ({
        venueId,
        venue: `Venue ${venueId}`,
        status: 'ATTENDING',
        respondedAt: null,
      })),
    },
    ...(seating === undefined ? {} : { seating }),
  };
}

describe('the guest’s own table on their personal page (design PD-71)', () => {
  it('shows nothing until the hosts publish the seating, or with no seat at all', () => {
    expect(yourTables(guest(null))).toBeNull();
    expect(yourTables(guest(undefined))).toBeNull();
    expect(yourTables(guest({ table: null, assignments: [], household: [] }))).toBeNull();
  });

  it('gives each seat with its venue, in the host’s venue order, a held one marked', () => {
    const seating = {
      table: null,
      assignments: [seat('Table 4', 'hall', { isReservation: true }), seat('Pew 2', 'church')],
      household: [],
    };
    expect(yourTables(guest(seating, ['church', 'hall']))?.own).toEqual([
      { venue: 'Venue church', table: 'Pew 2', isReservation: false },
      { venue: 'Venue hall', table: 'Table 4', isReservation: true },
    ]);
  });

  it('reads the single table an older answer gives', () => {
    const seating = { table: 'Table 3', household: [] };
    expect(yourTables(guest(seating))?.own).toEqual([
      { venue: null, table: 'Table 3', isReservation: false },
    ]);
  });

  it('names a household member only where they sit at another table, never the guest', () => {
    const own = [seat('Table 4', 'hall'), seat('Pew 2', 'church')];
    const seating = {
      table: null,
      assignments: own,
      household: [
        { id: 'g1', name: 'Armen Petrosyan', table: null, assignments: own },
        {
          id: 'g2',
          name: 'Lusine Petrosyan',
          table: null,
          assignments: [seat('Table 4', 'hall'), seat('Pew 5', 'church')],
        },
        { id: 'g3', name: 'Ani Petrosyan', table: null, assignments: [] },
      ],
    };
    expect(yourTables(guest(seating, ['church', 'hall']))?.others).toEqual([
      {
        name: 'Lusine Petrosyan',
        seats: [{ venue: 'Venue church', table: 'Pew 5', isReservation: false }],
      },
    ]);
  });

  it('still names the household’s tables when the guest has none', () => {
    const seating = {
      table: null,
      assignments: [],
      household: [
        {
          id: 'g2',
          name: 'Lusine Petrosyan',
          table: 'Table 4',
          assignments: [seat('Table 4', null)],
        },
      ],
    };
    const tables = yourTables(guest(seating));
    expect(tables?.own).toEqual([]);
    expect(tables?.others).toHaveLength(1);
  });
});
