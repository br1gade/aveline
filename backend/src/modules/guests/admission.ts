import { assertRequiredAcknowledgements } from '../guest-contributions/acknowledgement-writes';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockAttendancePolicy } from '../rsvp/attendance/attendance-context';

/** Every admission/link/cancellation writer locks policy, order, guest, then ticket. */
export async function lockAdmission(tx: Prisma.TransactionClient, eventId: string, ticket: { id: string; orderId: string; guestId: string | null } | null, guestId?: string) {
  await lockAttendancePolicy(tx, eventId);
  if (ticket) await tx.$queryRaw`SELECT id FROM ticket_orders WHERE id = ${ticket.orderId} FOR UPDATE`;
  const personId = guestId ?? ticket?.guestId;
  if (personId) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM guests WHERE id = ${personId} AND "eventId" = ${eventId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('That guest is not on this event');
  }
  await assertAcknowledgedAdmission(tx, eventId, personId);
  if (ticket) {
    await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${ticket.id} FOR UPDATE`;
    const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { order: { select: { status: true, cancellationStartedAt: true } } } });
    if (current.guestId !== ticket.guestId) throw new ConflictException('Ticket was linked to another guest; refresh');
    assertTicketAdmits(current);
    return current;
  }
  // A host linking while a guest-only scan waited must not create two admissions.
  if (personId && await tx.ticket.count({ where: { guestId: personId } })) throw new ConflictException('Ticket was linked; refresh and scan again');
  return null;
}

export function assertTicketAdmits(ticket: { status: string; order: { status: string; cancellationStartedAt: Date | null } }) {
  if (ticket.order.status !== 'PAID' || ticket.order.cancellationStartedAt) throw new BadRequestException('Ticket order is cancelled or cancellation is in progress');
  if (ticket.status !== 'VALID') throw new BadRequestException(`Ticket already ${ticket.status.toLowerCase()}`);
}

export async function recordAdmission(tx: Prisma.TransactionClient, ticketId: string | null, guestId: string | null, notedBy?: string) {
  const arrivedAt = new Date();
  if (guestId) {
    const existing = await tx.checkIn.findUnique({ where: { guestId }, select: { arrivedAt: true } });
    if (existing) throw new ConflictException(`Guest was already checked in at ${existing.arrivedAt.toISOString()}`);
    await tx.checkIn.create({ data: { guestId, arrivedAt, notedBy: notedBy ?? null } });
  }
  if (ticketId) await tx.ticket.update({ where: { id: ticketId }, data: { status: 'USED', usedAt: arrivedAt } });
  return arrivedAt;
}

export async function undoAdmission(tx: Prisma.TransactionClient, eventId: string, guestId: string) {
  const ticket = await tx.ticket.findUnique({ where: { guestId, eventId } });
  await lockAttendancePolicy(tx, eventId);
  if (ticket) await tx.$queryRaw`SELECT id FROM ticket_orders WHERE id = ${ticket.orderId} FOR UPDATE`;
  const guests = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM guests WHERE id = ${guestId} AND "eventId" = ${eventId} FOR UPDATE`;
  if (!guests.length) throw new NotFoundException('That guest is not on this event');
  if (ticket) await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${ticket.id} FOR UPDATE`;
  const current = await tx.ticket.findUnique({ where: { guestId }, select: { id: true } });
  if (current?.id !== ticket?.id) throw new ConflictException('Ticket was linked; refresh and undo again');
  const removed = await tx.checkIn.deleteMany({ where: { guestId } });
  if (!removed.count) throw new NotFoundException('That guest is not checked in');
  if (ticket) await tx.ticket.updateMany({ where: { id: ticket.id, guestId, status: 'USED', order: { status: 'PAID', cancellationStartedAt: null } }, data: { status: 'VALID', usedAt: null } });
}

async function assertAcknowledgedAdmission(tx: Prisma.TransactionClient, eventId: string, personId: string | null | undefined) {
  if (personId) return assertRequiredAcknowledgements(tx, eventId, [personId]);
  if (await tx.rsvpQuestion.count({ where: { invitation: { eventId }, type: 'SIGNATURE', required: true } })) {
    throw new BadRequestException('acknowledgements: register the ticket attendee and collect their acknowledgement before check-in');
  }
}
