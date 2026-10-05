import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RsvpStatus } from '@prisma/client';
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
    const guest = await this.prisma.guest.findFirst({
      where: { id: guestId, eventId },
      include: { checkIn: true, rsvp: true, seat: { include: { table: true } } },
    });
    if (!guest) throw new NotFoundException('That guest is not on this event');

    if (guest.checkIn) {
      throw new ConflictException(
        `${guest.firstName} was already checked in at ${guest.checkIn.arrivedAt.toISOString()}`,
      );
    }

    const created = await this.prisma.checkIn.create({
      data: { guestId, notedBy: notedBy ?? null },
    });

    return {
      guestId,
      name: [guest.firstName, guest.lastName].filter(Boolean).join(' '),
      arrivedAt: created.arrivedAt,
      // The two things door staff need next: where to send them, and whether
      // they were expected — someone who declined still turning up is worth
      // flagging rather than silently admitting.
      table: guest.seat?.table.name ?? null,
      wasExpected: guest.rsvp?.status === RsvpStatus.ATTENDING,
    };
  }

  /** Mis-scans happen; undoing one must be as easy as making it. */
  async undo(eventId: string, guestId: string) {
    const removed = await this.prisma.checkIn.deleteMany({
      where: { guestId, guest: { eventId } },
    });
    if (removed.count === 0) throw new NotFoundException('That guest is not checked in');
    return { ok: true as const };
  }

  /** Live arrivals, which is what a host watches on the day. */
  async arrivals(eventId: string) {
    const [expected, arrived, recent] = await Promise.all([
      this.prisma.guest.count({ where: { eventId, rsvp: { status: RsvpStatus.ATTENDING } } }),
      this.prisma.checkIn.count({ where: { guest: { eventId } } }),
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
      stillToCome: Math.max(0, expected - arrived),
      recent: recent.map((entry) => ({
        name: [entry.guest.firstName, entry.guest.lastName].filter(Boolean).join(' '),
        arrivedAt: entry.arrivedAt,
      })),
    };
  }
}
