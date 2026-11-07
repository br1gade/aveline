import type { Prisma } from '@prisma/client';

const TABLE_FIELDS = {
  id: true, name: true, capacity: true, zone: true, shape: true, venueId: true, arrangementId: true, posX: true, posY: true,
  venue: { select: { name: true } },
  seats: {
    where: { guest: { anonymizedAt: null } },
    orderBy: [{ position: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    select: { position: true, guest: { select: { firstName: true, lastName: true } } },
  },
  _count: { select: { seatReleases: true, seats: true } },
} satisfies Prisma.TableSelect;

/** Read publication and seats through the caller's capability snapshot. */
export async function readPublishedVendorSeating(tx: Prisma.TransactionClient, eventId: string) {
  const published = await tx.event.findFirst({
    where: { id: eventId, seatingPublishedAt: { not: null } },
    select: { tables: { select: TABLE_FIELDS, orderBy: [{ arrangementId: 'asc' }, { name: 'asc' }, { id: 'asc' }] } },
  });
  return published?.tables.map(({ seats, _count, venue, ...table }) => ({
    ...table,
    venue: venue?.name ?? null,
    // Erasure hides names but does not give away their assigned seats.
    seated: _count.seats,
    available: table.capacity - _count.seats,
    releasedCount: _count.seatReleases,
    // Older clients use released.length. Keep the length without loading release records.
    released: Array.from({ length: _count.seatReleases }, () => null),
    guests: seats.map(({ guest, position }) => ({
      name: [guest.firstName, guest.lastName].filter(Boolean).join(' '), position,
    })),
  }));
}
