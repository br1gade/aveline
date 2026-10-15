import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, Ticket } from '@prisma/client';
import { LinkTicketGuestDto } from './dto/reconcile-attendee.dto';

/** Order is already locked; household locks precede guests just as household editing does. */
export async function lockLinkPeople(tx: Prisma.TransactionClient, eventId: string, ids: string[]) {
  await tx.$queryRaw`SELECT id FROM households WHERE id IN (SELECT "householdId" FROM guests WHERE id IN (${Prisma.join(ids)})) ORDER BY id FOR UPDATE`;
  const guests = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM guests WHERE "eventId" = ${eventId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  if (new Set(ids).size !== guests.length) throw new NotFoundException('Guest not found on this event');
}

export async function linkTicketPerson(tx: Prisma.TransactionClient, ticket: Ticket, dto: LinkTicketGuestDto) {
  if (ticket.guestId === dto.guestId) return { ticketId: ticket.id, guestId: dto.guestId };
  if (ticket.guestId !== dto.expectedGuestId) throw new ConflictException('Ticket guest changed; review the current link');
  const target = await tx.guest.findUniqueOrThrow({ where: { id: dto.guestId }, include: { checkIn: true, ticket: true } });
  if (target.anonymizedAt) throw new ConflictException('An erased guest cannot be linked');
  if (target.ticket) throw new ConflictException('Guest already has a ticket');
  const source = await archiveCheckoutGuest(tx, ticket);
  await tx.ticket.update({ where: { id: ticket.id }, data: { guestId: target.id, holderName: [target.firstName, target.lastName].filter(Boolean).join(' '), holderEmail: target.email } });
  await synchronizeAdmission(tx, ticket, target);
  if (source) await removeCheckoutGuest(tx, source);
  return { ticketId: ticket.id, guestId: target.id };
}

async function archiveCheckoutGuest(tx: Prisma.TransactionClient, ticket: Ticket) {
  if (!ticket.guestId) return null;
  const attendee = await tx.orderAttendee.findUnique({ where: { id: ticket.attendeeId ?? '' } });
  if (attendee?.erasedAt) throw new ConflictException('An erased attendee cannot be linked');
  if (attendee?.generatedGuestId !== ticket.guestId) throw new ConflictException('An invited guest cannot be replaced by another person');
  const source = await tx.guest.findUniqueOrThrow({ where: { id: ticket.guestId }, select: {
    id: true, householdId: true, isPrimary: true, firstName: true, lastName: true, email: true, phone: true, locale: true,
    attribution: true, addedByGuest: true, consentAt: true, consentSource: true, createdAt: true, updatedAt: true,
    rsvp: { include: { answers: true } }, checkIn: true,
    _count: { select: { seats: true, seatReleases: true, attendanceResponses: true, messages: true, channels: true, deviceTokens: true } },
  } });
  assertSourceCanBeRemoved(source);
  if (source._count.attendanceResponses > 1000) throw new ConflictException('Attendance history is too large for automatic reconciliation');
  const responses = await tx.attendanceResponse.findMany({ where: { guestId: source.id }, orderBy: [{ revision: 'asc' }, { scopeId: 'asc' }] });
  const snapshot = JSON.parse(JSON.stringify({ ...source, email: source.email?.toLowerCase() ?? null, attendanceResponses: responses })) as Prisma.InputJsonValue;
  await tx.orderAttendee.update({ where: { id: attendee.id }, data: { linkedSourceSnapshot: snapshot } });
  return source;
}

async function removeCheckoutGuest(tx: Prisma.TransactionClient, source: { id: string; householdId: string; isPrimary: boolean }) {
  await tx.guest.delete({ where: { id: source.id } });
  const next = await tx.guest.findFirst({ where: { householdId: source.householdId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!next) {
    await tx.household.delete({ where: { id: source.householdId } });
    return;
  }
  await tx.household.update({ where: { id: source.householdId }, data: { seatsAllotted: { decrement: 1 } } });
  if (source.isPrimary) await tx.guest.update({ where: { id: next.id }, data: { isPrimary: true } });
}

export async function synchronizeAdmission(tx: Prisma.TransactionClient, ticket: Ticket, guest: { id: string; checkIn: { arrivedAt: Date } | null }) {
  if (ticket.status === 'USED' && !ticket.usedAt) throw new ConflictException('Used legacy ticket has no admission timestamp; staff review is required');
  assertMatchingAdmission(ticket, guest);
  if (ticket.status === 'USED' && !guest.checkIn) {
    await tx.checkIn.create({ data: { guestId: guest.id, arrivedAt: ticket.usedAt! } });
  } else if (guest.checkIn && ticket.status === 'VALID') {
    await tx.ticket.update({ where: { id: ticket.id }, data: { status: 'USED', usedAt: guest.checkIn.arrivedAt } });
  }
}

function assertSourceCanBeRemoved(source: { checkIn: unknown; rsvp: { signatureAssetId: string | null } | null; _count: { seats: number; seatReleases: number; messages: number; channels: number; deviceTokens: number } }) {
  if (source.checkIn || source.rsvp?.signatureAssetId || [source._count.seats, source._count.seatReleases, source._count.messages, source._count.channels, source._count.deviceTokens].some((count) => count > 0)) {
    throw new ConflictException('Checkout guest has seats, admission, a signature or communication history; resolve those before linking');
  }
}

function assertMatchingAdmission(ticket: Ticket, guest: { checkIn: { arrivedAt: Date } | null }) {
  if (ticket.status === 'USED' && guest.checkIn && ticket.usedAt?.getTime() !== guest.checkIn.arrivedAt.getTime()) {
    throw new ConflictException('Two admission records disagree; staff review is required');
  }
}
