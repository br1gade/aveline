import { Injectable } from '@nestjs/common';
import { Prisma, RsvpStatus } from '@prisma/client';
import { DEFAULT_PAGE_SIZE } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { DoorRosterDto, DoorRosterQuery } from './dto/door-roster.dto';

@Injectable()
export class DoorRosterService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventId: string, query: DoorRosterQuery, canReadSeating: boolean): Promise<DoorRosterDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const guests = await this.prisma.guest.findMany({
      where: { eventId, id: query.cursor ? { gt: query.cursor } : undefined, AND: nameMatches(query.search) },
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: {
        id: true, firstName: true, lastName: true, anonymizedAt: true,
        household: { select: { name: true } },
        rsvp: { select: { status: true } },
        checkIn: { select: { arrivedAt: true } },
        ticket: { select: { id: true } },
        seats: {
          orderBy: { arrangementId: 'asc' },
          select: { position: true, table: { select: { name: true, venue: { select: { name: true } } } } },
        },
      },
    });

    const items = guests.slice(0, limit).map((guest) => ({
      guestId: guest.id,
      name: [guest.firstName, guest.lastName].filter(Boolean).join(' '),
      householdName: guest.household.name,
      seating: (canReadSeating ? guest.seats : []).map(({ table, position }) => ({ table: table.name, venue: table.venue?.name ?? null, position })),
      attendance: guest.rsvp?.status ?? RsvpStatus.PENDING,
      arrivedAt: guest.checkIn?.arrivedAt ?? null,
      hasTicket: guest.ticket !== null,
      isErased: guest.anonymizedAt !== null,
    }));
    return { items, nextCursor: guests.length > limit ? items[limit - 1].guestId : null };
  }
}

function nameMatches(search = ''): Prisma.GuestWhereInput[] {
  return search.trim().split(/\s+/u).filter(Boolean).map((word) => {
    const text = { contains: word.replace(/[\\%_]/gu, '\\$&'), mode: Prisma.QueryMode.insensitive };
    return { OR: [{ firstName: text }, { lastName: text }, { household: { name: text } }] };
  });
}
