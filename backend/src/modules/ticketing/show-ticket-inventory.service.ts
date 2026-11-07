import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { lockEventOrganization, requireCurrentEventPermission } from '../../infra/auth/access-locks';
import { lockLiveEvent } from '../events/event-lock';
import { PublishShowTicketInventoryDto } from './dto/show-ticket-inventory.dto';
import { TicketSectionMode } from './dto/venue-ticket-layout.dto';
import type { TicketLayoutSection } from './venue-ticket-layout-definition';

const summary = {
  eventId: true, venueId: true, layoutVersionId: true, publishedAt: true,
  sections: { orderBy: { position: 'asc' }, select: {
    key: true, name: true, capacity: true, offers: { orderBy: { ticketTypeId: 'asc' }, select: { ticketTypeId: true } },
  } },
} satisfies Prisma.ShowTicketInventorySelect;

@Injectable()
export class ShowTicketInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(eventId: string, dto: PublishShowTicketInventoryDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockEventOrganization(tx, eventId);
      await lockLiveEvent(tx, eventId);
      await requireCurrentEventPermission(tx, { actor: { userId }, eventId, permission: 'event:write' });
      if (await tx.showTicketInventory.findUnique({ where: { eventId }, select: { eventId: true } })) {
        throw new ConflictException('Ticket inventory is already published for this show');
      }
      if (await tx.ticketOrder.findFirst({ where: { eventId }, select: { id: true } })) {
        throw new ConflictException('This show already has quantity-based orders');
      }
      const layout = await requireShowLayout(tx, eventId, dto);
      const ticketTypeIds = [...new Set(dto.offers.map((offer) => offer.ticketTypeId))];
      const types = await tx.ticketType.findMany({ where: { eventId, id: { in: ticketTypeIds } }, select: { id: true } });
      if (types.length !== ticketTypeIds.length) throw new BadRequestException('offers: use ticket types from this event');
      const sections = buildSections(layout, dto);
      await tx.venue.update({ where: { id: dto.venueId }, data: { ticketLayoutVersionId: dto.layoutVersionId } });
      return tx.showTicketInventory.create({
        data: { eventId, venueId: dto.venueId, layoutVersionId: dto.layoutVersionId,
          sections: { create: sections } },
        select: summary,
      });
    }, { timeout: 15_000 });
  }

  read(eventId: string) {
    return this.prisma.showTicketInventory.findUnique({ where: { eventId }, select: summary });
  }

  async readPublicSection(slug: string, key: string) {
    const now = new Date();
    const section = await this.prisma.showTicketSection.findFirst({
      where: { key, inventory: { event: { startsAt: { gt: now }, status: 'PUBLISHED', visibility: { not: 'PRIVATE' },
        listing: { slug, publishedAt: { lte: now } } } } },
      select: { key: true, name: true, capacity: true, quantityClaimed: true,
        inventory: { select: { layoutVersionId: true } },
        seats: { where: { isBlocked: false, orderId: null }, orderBy: { position: 'asc' }, select: { id: true, row: true, label: true } },
        offers: { select: { ticketType: { select: { id: true, isActive: true, quantityTotal: true, quantitySold: true,
          quantityReserved: true, salesStartAt: true, salesEndAt: true } } } } },
    });
    if (!section) throw new NotFoundException('No published inventory for this section');
    const ticketTypeIds = section.offers.map(({ ticketType }) => ticketType).filter((type) => isAvailable(type, now)).map(({ id }) => id);
    const seats = ticketTypeIds.length ? section.seats : [];
    const zoneAvailable = ticketTypeIds.length && section.capacity !== null ? section.capacity - section.quantityClaimed : 0;
    return { layoutVersionId: section.inventory.layoutVersionId, key: section.key, name: section.name, ticketTypeIds, seats,
      mode: section.capacity === null ? TicketSectionMode.NUMBERED : TicketSectionMode.UNNUMBERED,
      available: section.capacity === null ? seats.length : zoneAvailable };
  }
}

async function requireShowLayout(tx: Prisma.TransactionClient, eventId: string, dto: PublishShowTicketInventoryDto) {
  const venue = await tx.venue.findFirst({
    where: { id: dto.venueId, eventId, role: { not: 'PREPARATION' }, profile: { isActive: true } },
    select: { profileId: true },
  });
  const layout = venue?.profileId && await tx.venueTicketLayoutVersion.findFirst({
    where: { id: dto.layoutVersionId, profileId: venue.profileId }, select: { sections: true },
  });
  if (!layout) throw new NotFoundException('No such layout version for this show venue');
  return layout.sections as unknown as TicketLayoutSection[];
}

function isAvailable(type: { isActive: boolean; quantityTotal: number; quantitySold: number; quantityReserved: number;
  salesStartAt: Date | null; salesEndAt: Date | null }, now: Date) {
  return type.isActive && type.quantityTotal > type.quantitySold + type.quantityReserved
    && (!type.salesStartAt || type.salesStartAt <= now) && (!type.salesEndAt || type.salesEndAt >= now);
}

function buildSections(layout: TicketLayoutSection[], dto: PublishShowTicketInventoryDto) {
  const offered = new Map<string, Set<string>>();
  for (const { sectionKey, ticketTypeId } of dto.offers) {
    const types = offered.get(sectionKey) ?? new Set<string>();
    if (types.has(ticketTypeId)) throw new BadRequestException('offers: list a price only once per section');
    offered.set(sectionKey, types.add(ticketTypeId));
  }
  const keys = new Set(layout.map(({ key }) => key));
  if ([...offered.keys()].some((key) => !keys.has(key))) throw new BadRequestException('offers: use sections in the selected layout');

  const blocked = new Set(dto.blockedSeats?.map(({ sectionKey, row, seat }) => seatKey(sectionKey, row, seat)));
  const sections = layout.flatMap((section, position) => {
    const types = offered.get(section.key);
    if (!types) return [];
    return [{
      key: section.key, name: section.name, position,
      capacity: section.mode === TicketSectionMode.UNNUMBERED ? section.capacity : null,
      offers: { createMany: { data: [...types].map((ticketTypeId) => ({ ticketTypeId })) } },
      seats: { createMany: { data: buildSeats(section, blocked) } },
    }];
  });
  if (blocked.size) throw new BadRequestException('blockedSeats: use existing seats in sections with offers');
  return sections;
}

function buildSeats(section: TicketLayoutSection, blocked: Set<string>) {
  if (section.mode !== TicketSectionMode.NUMBERED) return [];
  let position = 0;
  return section.rows.flatMap(({ label: row, seats }) => seats.map((label) => ({
    row, label, position: position++, isBlocked: blocked.delete(seatKey(section.key, row, label)),
  })));
}

function seatKey(section: string, row: string, seat: string) {
  return JSON.stringify([section, row, seat]);
}
