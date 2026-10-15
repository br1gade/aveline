import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function resolveArrangement(tx: Prisma.TransactionClient, eventId: string, arrangementId?: string) {
  if (arrangementId) {
    const arrangement = await tx.seatingArrangement.findFirst({ where: { id: arrangementId, eventId } });
    if (!arrangement) throw new NotFoundException('arrangementId: no such seating arrangement on this event');
    return arrangement;
  }
  const active = await tx.seatingArrangement.findMany({
    where: { eventId, OR: [{ tables: { some: {} } }, { releases: { some: {} } }] },
    take: 2,
  });
  if (active.length > 1) throw new BadRequestException('arrangementId: choose a seating arrangement for this event');
  if (active.length === 1) return active[0];
  const legacy = await tx.seatingArrangement.findFirst({ where: { eventId, venueId: null } });
  if (!legacy) throw new NotFoundException('No such event');
  return legacy;
}

export async function assertArrangement(prisma: Pick<Prisma.TransactionClient, 'seatingArrangement'>, eventId: string, id?: string) {
  if (!id) return;
  const found = await prisma.seatingArrangement.findFirst({ where: { id, eventId }, select: { id: true } });
  if (!found) throw new NotFoundException('arrangementId: no such seating arrangement on this event');
}

/** All writers take the arrangement lock before table locks, so venue capacity is serialized. */
export async function lockArrangement(tx: Prisma.TransactionClient, eventId: string, arrangementId: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM seating_arrangements WHERE id = ${arrangementId} AND "eventId" = ${eventId} FOR UPDATE`;
  if (locked.length === 0) throw new NotFoundException('No such seating arrangement on this event');
  const arrangement = await tx.seatingArrangement.findUniqueOrThrow({
    where: { id: arrangementId }, include: { venue: { select: { capacity: true } } },
  });
  const occupied = await tx.seat.count({ where: { arrangementId } });
  return { capacity: arrangement.venue?.capacity ?? null, occupied };
}

/** Guest keys precede answer locks: host RSVP writes already lock the guest first. */
export async function lockGuestAnswer(tx: Prisma.TransactionClient, eventId: string, guestId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM guests WHERE id = ${guestId} AND "eventId" = ${eventId} FOR KEY SHARE`;
  if (rows.length === 0) throw new NotFoundException('That guest is not on this event');
  await tx.$queryRaw`SELECT id FROM rsvps WHERE "guestId" = ${guestId} FOR SHARE`;
}

/** Busy answers are deferred as whole households; waiting while holding other answers can deadlock a submission. */
export async function lockAttendingAnswers(tx: Prisma.TransactionClient, eventId: string, arrangementId: string) {
  const candidates = await tx.guest.findMany({
    where: { eventId, ...await attendanceEligibility(tx, eventId, arrangementId), rsvp: { status: 'ATTENDING' }, seats: { none: { arrangementId } } },
    select: { id: true, householdId: true },
  });
  if (candidates.length === 0) return { guestIds: [], deferred: [] };
  const guests = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM guests WHERE id IN (${Prisma.join(candidates.map((guest) => guest.id))})
    ORDER BY id FOR KEY SHARE SKIP LOCKED`;
  const ready = await lockReadyAnswers(tx, guests.map((guest) => guest.id));
  const eligible = await tx.guest.findMany({
    where: { id: { in: ready }, ...await attendanceEligibility(tx, eventId, arrangementId) }, select: { id: true },
  });
  return deferChangingHouseholds(candidates, new Set(eligible.map((guest) => guest.id)));
}

async function lockReadyAnswers(tx: Prisma.TransactionClient, guestIds: string[]) {
  if (guestIds.length === 0) return [];
  const answers = await tx.$queryRaw<{ guestId: string }[]>`
    SELECT "guestId" FROM rsvps WHERE "guestId" IN (${Prisma.join(guestIds)}) AND status = 'ATTENDING'
    ORDER BY "guestId" FOR SHARE SKIP LOCKED`;
  return answers.map((answer) => answer.guestId);
}

function deferChangingHouseholds(candidates: { id: string; householdId: string }[], ready: Set<string>) {
  const blocked = new Set(candidates.filter((guest) => !ready.has(guest.id)).map((guest) => guest.householdId));
  const sizes = new Map<string, number>();
  for (const guest of candidates) {
    if (blocked.has(guest.householdId)) sizes.set(guest.householdId, (sizes.get(guest.householdId) ?? 0) + 1);
  }
  return {
    guestIds: candidates.filter((guest) => !blocked.has(guest.householdId)).map((guest) => guest.id),
    deferred: [...sizes].map(([householdId, size]) => ({
      householdId, size, reason: 'Attendance changed or a guest is being updated; refresh and run again',
    })),
  };
}

async function attendanceEligibility(tx: Prisma.TransactionClient, eventId: string, arrangementId: string): Promise<Prisma.GuestWhereInput> {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { attendanceMode: true, attendanceRevision: true } });
  if (event.attendanceMode === 'EVENT_WIDE') return {};
  const arrangement = await tx.seatingArrangement.findUniqueOrThrow({ where: { id: arrangementId }, select: { venueId: true } });
  if (!arrangement.venueId) return { id: { in: [] } };
  return { attendanceResponses: { some: { revision: event.attendanceRevision, venueId: arrangement.venueId, status: 'ATTENDING' } } };
}
