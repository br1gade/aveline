import { AdmissionRefusal } from '../../common/admission-refusal';
import { findMissingRequiredAcknowledgements, requiredAcknowledgementMessage } from '../guest-contributions/acknowledgement-writes';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, TicketOrderStatus, TicketStatus } from '@prisma/client';
import { lockAttendancePolicy } from '../rsvp/attendance/attendance-context';

/** Every admission/link/cancellation writer locks policy, order, guest, then ticket. */
export async function lockAdmission(tx: Prisma.TransactionClient, eventId: string, ticket: { id: string; orderId: string; guestId: string | null } | null, guestId?: string) {
  await lockAttendancePolicy(tx, eventId);
  if (ticket) await tx.$queryRaw`SELECT id FROM ticket_orders WHERE id = ${ticket.orderId} FOR UPDATE`;
  const personId = guestId ?? ticket?.guestId;
  if (personId) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM guests WHERE id = ${personId} AND "eventId" = ${eventId} FOR UPDATE`;
    if (!rows.length) throw new AdmissionRefusal('ADMISSION_TARGET_NOT_FOUND', 'That guest is not on this event');
  }
  if (ticket) return lockTicketAdmission(tx, eventId, ticket, personId);
  // A host linking while a guest-only scan waited must not create two admissions.
  if (personId && await tx.ticket.count({ where: { guestId: personId } })) throw new AdmissionRefusal('ADMISSION_LINK_CHANGED', 'Ticket was linked; refresh and scan again');
  if (personId) await assertGuestMayEnter(tx, { eventId, guestId: personId });
  return null;
}

async function lockTicketAdmission(tx: Prisma.TransactionClient, eventId: string, ticket: { id: string; guestId: string | null }, personId?: string | null) {
  await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${ticket.id} FOR UPDATE`;
  const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { order: { select: { status: true, cancellationStartedAt: true } } } });
  if (current.guestId !== ticket.guestId) throw new AdmissionRefusal('ADMISSION_LINK_CHANGED', 'Ticket was linked to another guest; refresh');
  await assertTicketAdmits(tx, current);
  if (personId) await assertGuestMayEnter(tx, { eventId, guestId: personId, ticket: current });
  else await assertRegisteredAttendee(tx, eventId, current);
  return current;
}

export async function recordAdmission(tx: Prisma.TransactionClient, ticketId: string | null, guestId: string | null, notedBy?: string) {
  const arrivedAt = new Date();
  if (guestId) {
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

async function assertRegisteredAttendee(tx: Prisma.TransactionClient, eventId: string, ticket: Parameters<typeof ticketIdentity>[0]) {
  if (await tx.rsvpQuestion.count({ where: { invitation: { eventId }, type: 'SIGNATURE', required: true } })) {
    throw new AdmissionRefusal('TICKET_ATTENDEE_REQUIRED',
      'acknowledgements: register the ticket attendee and collect their acknowledgement before check-in', ticketIdentity(ticket));
  }
}

interface DoorTicket {
  guestId: string | null;
  holderName: string | null;
  usedAt: Date | null;
  status: TicketStatus;
  order: { status: TicketOrderStatus; cancellationStartedAt: Date | null };
}

async function assertTicketAdmits(tx: Prisma.TransactionClient, ticket: DoorTicket) {
  const { status, order } = ticket;
  if (order.status !== TicketOrderStatus.PAID || order.cancellationStartedAt) {
    throw new AdmissionRefusal('TICKET_ORDER_UNAVAILABLE', 'Ticket order is cancelled or cancellation is in progress', {
      orderStatus: order.status, isCancellationPending: order.status === TicketOrderStatus.PAID && order.cancellationStartedAt !== null,
    });
  }
  if (status === TicketStatus.USED) {
    throw new AdmissionRefusal('TICKET_ALREADY_USED', 'Ticket already used', await usedTicketFacts(tx, ticket));
  }
  if (status !== TicketStatus.VALID) {
    throw new AdmissionRefusal('TICKET_STATUS_UNAVAILABLE', `Ticket already ${ticket.status.toLowerCase()}`, { ticketStatus: status });
  }
}

async function usedTicketFacts(tx: Prisma.TransactionClient, ticket: DoorTicket) {
  const usedAt = ticket.usedAt?.toISOString();
  if (!ticket.guestId) return { ...ticketIdentity(ticket), usedAt };
  const identity = await guestIdentity(tx, ticket.guestId, ticket);
  if (usedAt) return { ...identity, usedAt };
  const checkIn = await tx.checkIn.findUnique({ where: { guestId: ticket.guestId }, select: { arrivedAt: true } });
  return { ...identity, arrivedAt: checkIn?.arrivedAt.toISOString() };
}

async function assertGuestMayEnter(tx: Prisma.TransactionClient, input: { eventId: string; guestId: string; ticket?: DoorTicket }) {
  const { eventId, guestId, ticket } = input;
  const existing = await tx.checkIn.findUnique({ where: { guestId }, select: { arrivedAt: true } });
  if (existing) {
    throw new AdmissionRefusal('ADMISSION_ALREADY_CHECKED_IN', `Guest was already checked in at ${existing.arrivedAt.toISOString()}`, {
      ...await guestIdentity(tx, guestId, ticket), arrivedAt: existing.arrivedAt.toISOString(),
    });
  }
  const missing = await findMissingRequiredAcknowledgements(tx, eventId, [guestId], null);
  if (missing.length) {
    throw new AdmissionRefusal('ADMISSION_ACKNOWLEDGEMENTS_REQUIRED', requiredAcknowledgementMessage(missing), {
      ...await guestIdentity(tx, guestId, ticket),
      missingAcknowledgements: missing.map(({ questionId, prompt }) => ({ questionId, labels: displayLabels(prompt) })),
    });
  }
}

function ticketIdentity(ticket: Pick<DoorTicket, 'guestId' | 'holderName'>) {
  return { guestId: ticket.guestId ?? undefined, holderName: ticket.holderName ?? undefined };
}

async function guestIdentity(tx: Prisma.TransactionClient, guestId: string, ticket?: DoorTicket) {
  if (ticket?.holderName) return { guestId, holderName: ticket.holderName };
  const guest = await tx.guest.findUnique({ where: { id: guestId }, select: { firstName: true, lastName: true } });
  return { guestId, holderName: guest ? [guest.firstName, guest.lastName].filter(Boolean).join(' ') : undefined };
}

function displayLabels(prompt: Prisma.JsonValue) {
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return {};
  return Object.fromEntries(Object.entries(prompt).flatMap(([locale, label]) =>
    typeof label === 'string' ? [[locale, label.slice(0, 160)]] : []));
}
