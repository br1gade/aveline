import { lockAdmission, recordAdmission, undoAdmission } from './admission';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RsvpStatus } from '@prisma/client';
import { SEAT_DETAIL, seatingAssignments, singleTable } from '../seating/seat-view';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CheckInService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a guest arriving.
   *
   * Conditioned on no prior check-in, so two people on the door scanning the
   * same guest cannot both record an arrival and inflate the count.
   */
  async checkIn(eventId: string, guestId: string, notedBy?: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { guestId, eventId } });
    return this.prisma.$transaction(async (tx) => {
      const linked = await lockAdmission(tx, eventId, ticket, guestId);
      const guest = await tx.guest.findFirst({
        where: { id: guestId, eventId }, include: { rsvp: true, seats: { include: SEAT_DETAIL } },
      });
      if (!guest) throw new NotFoundException('That guest is not on this event');
      const arrivedAt = await recordAdmission(tx, linked?.id ?? null, guestId, notedBy);
      return {
        guestId,
        name: [guest.firstName, guest.lastName].filter(Boolean).join(' '),
        arrivedAt,
        // The two things door staff need next: where to send them, and whether
        // they were expected — someone who declined still turning up is worth
        // flagging rather than silently admitting.
        table: singleTable(guest.seats),
        seating: seatingAssignments(guest.seats),
        wasExpected: guest.rsvp?.status === RsvpStatus.ATTENDING,
      };
    });
  }

  /** Mis-scans happen; undoing one must be as easy as making it. */
  async undo(eventId: string, guestId: string) {
    await this.prisma.$transaction((tx) => undoAdmission(tx, eventId, guestId));
    return { ok: true as const };
  }

  /** Live arrivals, which is what a host watches on the day. */
  async arrivals(eventId: string) {
    const [expected, arrived, arrivedExpected, recent] = await Promise.all([
      this.prisma.guest.count({ where: { eventId, rsvp: { status: RsvpStatus.ATTENDING } } }),
      this.prisma.checkIn.count({ where: { guest: { eventId } } }),
      // Only arrivals who were expected come off "still to come": a walk-in,
      // or someone who declined and came anyway, was never in that number.
      this.prisma.checkIn.count({ where: { guest: { eventId, rsvp: { status: RsvpStatus.ATTENDING } } } }),
      this.prisma.checkIn.findMany({
        where: { guest: { eventId } },
        include: { guest: { select: { firstName: true, lastName: true } } },
        orderBy: { arrivedAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      expected,
      arrived,
      stillToCome: expected - arrivedExpected,
      unexpected: arrived - arrivedExpected,
      recent: recent.map((entry) => ({
        name: [entry.guest.firstName, entry.guest.lastName].filter(Boolean).join(' '),
        arrivedAt: entry.arrivedAt,
      })),
    };
  }
}
