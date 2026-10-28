import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { lockAttendancePolicy } from '../rsvp/attendance/attendance-context';
import { prepareRoster } from './checkout-roster';
import { createAttendeePeople } from './issue-attendees';
import { LinkTicketGuestDto, RegisterTicketAttendeeDto } from './dto/reconcile-attendee.dto';
import { linkTicketPerson, lockLinkPeople, synchronizeAdmission } from './ticket-link';

@Injectable()
export class TicketAttendeesService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrder(eventId: string, orderId: string, canSeeContacts: boolean) {
    const order = await this.prisma.ticketOrder.findFirst({ where: { id: orderId, eventId }, select: {
      id: true, status: true, cancellationStartedAt: true, attendees: { orderBy: { position: 'asc' }, select: {
        id: true, position: true, firstName: true, lastName: true, ticketTypeId: true, attendanceRevision: true,
        status: true, venueAttendance: true, email: canSeeContacts, phone: canSeeContacts,
      } }, tickets: { orderBy: { issuedAt: 'asc' }, select: {
        id: true, attendeeId: true, guestId: true, ticketTypeId: true, status: true, usedAt: true, holderName: true, code: canSeeContacts,
      } },
    } });
    if (!order) throw new NotFoundException('Order not found on this event');
    return order;
  }

  async register(eventId: string, ticketId: string, dto: RegisterTicketAttendeeDto) {
    return this.prisma.$transaction(async (tx) => {
      const ticket = await this.lockTicket(tx, eventId, ticketId);
      if (ticket.guestId || ticket.attendeeId) throw new ConflictException('Ticket already has an attendee; use the explicit link flow');
      if (dto.attendee.ticketTypeId !== ticket.ticketTypeId) throw new BadRequestException('attendee.ticketTypeId must match this ticket');
      if (dto.attendee.householdKey) throw new BadRequestException('Legacy registration creates one household; use host household tools to group guests');
      const rows = await prepareRoster(tx, eventId, { items: [{ ticketTypeId: ticket.ticketTypeId, quantity: 1 }],
        attendees: [dto.attendee], attendanceRevision: dto.attendanceRevision, buyerName: '', buyerEmail: '', idempotencyKey: '' });
      const maximum = await tx.orderAttendee.aggregate({ where: { orderId: ticket.orderId }, _max: { position: true } });
      const attendee = await tx.orderAttendee.create({ data: { ...rows[0], orderId: ticket.orderId, position: (maximum._max.position ?? -1) + 1 } });
      const order = await tx.ticketOrder.findUniqueOrThrow({ where: { id: ticket.orderId } });
      const [person] = await createAttendeePeople(tx, { ...order, createdAt: new Date(), items: [], attendees: [attendee] });
      await tx.ticket.update({ where: { id: ticketId }, data: { attendeeId: attendee.id, guestId: person.guestId,
        holderName: [attendee.firstName, attendee.lastName].filter(Boolean).join(' '), holderEmail: attendee.email } });
      await synchronizeAdmission(tx, ticket, { id: person.guestId, checkIn: null });
      return { ticketId, attendeeId: attendee.id, guestId: person.guestId };
    });
  }

  async linkGuest(eventId: string, ticketId: string, dto: LinkTicketGuestDto) {
    if (dto.keepExistingAnswers !== true || !isGuestPrecondition(dto.expectedGuestId)) throw new BadRequestException('expectedGuestId and keepExistingAnswers: true are required');
    return this.prisma.$transaction(async (tx) => {
      const ticket = await this.lockTicket(tx, eventId, ticketId, false);
      await lockLinkPeople(tx, eventId, [dto.guestId, ...(ticket.guestId ? [ticket.guestId] : [])]);
      await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${ticketId} FOR UPDATE`;
      return linkTicketPerson(tx, ticket, dto);
    });
  }

  private async lockTicket(tx: Prisma.TransactionClient, eventId: string, ticketId: string, shouldLockTicket = true) {
    await lockAttendancePolicy(tx, eventId);
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId, eventId } });
    if (!ticket) throw new NotFoundException('Ticket not found on this event');
    await tx.$queryRaw`SELECT id FROM ticket_orders WHERE id = ${ticket.orderId} FOR UPDATE`;
    if (shouldLockTicket) await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${ticketId} FOR UPDATE`;
    const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { order: { select: { status: true, cancellationStartedAt: true } } } });
    if (current.order.status !== 'PAID' || current.order.cancellationStartedAt || !['VALID', 'USED'].includes(current.status)) {
      throw new ConflictException('Only active paid tickets may be reconciled');
    }
    return current;
  }
}

function isGuestPrecondition(value: unknown) { return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 100); }
