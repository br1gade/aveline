import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GuestsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The guest graph for an event, grouped by household. */
  async listByHousehold(eventId: string) {
    const households = await this.prisma.household.findMany({
      where: { eventId },
      include: {
        guests: { include: { rsvp: true, seat: { include: { table: true } } }, orderBy: { isPrimary: 'desc' } },
      },
      orderBy: { name: 'asc' },
    });

    return households.map((h) => ({
      id: h.id,
      name: h.name,
      seatsAllotted: h.seatsAllotted,
      seatsNamed: h.guests.length,
      notes: h.notes,
      guests: h.guests.map((g) => ({
        id: g.id,
        name: [g.firstName, g.lastName].filter(Boolean).join(' '),
        token: g.token,
        attribution: g.attribution,
        isPrimary: g.isPrimary,
        addedByGuest: g.addedByGuest,
        rsvpStatus: g.rsvp?.status ?? 'PENDING',
        table: g.seat?.table.name ?? null,
      })),
    }));
  }

  /** Guest-facing seat lookup — the find-your-seat surface in spec §6. */
  async findSeat(eventId: string, query: string) {
    const guests = await this.prisma.guest.findMany({
      where: {
        eventId,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: { seat: { include: { table: true } } },
      take: 10,
    });

    return guests.map((g) => ({
      name: [g.firstName, g.lastName].filter(Boolean).join(' '),
      table: g.seat?.table.name ?? null,
    }));
  }
}
