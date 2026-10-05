import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { VenueRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVenueDto } from './dto/design.dto';

/**
 * Venues on an event.
 *
 * This is the one place an address is typed, and it then appears in the
 * invitation's venue block, the map block, the day-of timeline and the vendor
 * brief — the one-way data flow the product spec commits to (§7). Until now
 * only the seed script could create one, which left the VENUE block with
 * nothing to bind to.
 */
@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The reusable directory, so a popular hall is typed once per platform. */
  listProfiles(city?: string) {
    return this.prisma.venueProfile.findMany({
      where: { isActive: true, city },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, address: true, city: true, capacity: true },
    });
  }

  listForEvent(eventId: string) {
    return this.prisma.venue.findMany({
      where: { eventId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        role: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        mapUrl: true,
        arriveAt: true,
        capacity: true,
        profileId: true,
      },
    });
  }

  /**
   * Adds a venue, copying the directory entry's details when one is named.
   *
   * Copied rather than referenced: a hall that changes its address next year
   * must not silently rewrite the address on an invitation already sent.
   */
  async create(eventId: string, dto: CreateVenueDto) {
    const role = asVenueRole(dto.role);
    const profile = dto.profileId ? await this.requireProfile(dto.profileId) : null;

    const last = await this.prisma.venue.findFirst({
      where: { eventId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return this.prisma.venue.create({
      data: {
        eventId,
        role,
        name: dto.name,
        address: dto.address,
        mapUrl: dto.mapUrl ?? null,
        arriveAt: dto.arriveAt ? new Date(dto.arriveAt) : null,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        ...fromProfile(profile),
      },
    });
  }

  async update(eventId: string, venueId: string, dto: Partial<CreateVenueDto>) {
    await this.require(eventId, venueId);

    return this.prisma.venue.update({
      where: { id: venueId },
      data: {
        role: dto.role === undefined ? undefined : asVenueRole(dto.role),
        name: dto.name ?? undefined,
        address: dto.address ?? undefined,
        mapUrl: dto.mapUrl ?? undefined,
        arriveAt: dto.arriveAt === undefined ? undefined : new Date(dto.arriveAt),
      },
    });
  }

  /**
   * Removes a venue nothing else depends on.
   *
   * Timeline entries and tables point at a venue; deleting it would cascade
   * them to null and quietly detach a running order from where it happens.
   */
  async remove(eventId: string, venueId: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, eventId },
      include: { _count: { select: { timeline: true, tables: true } } },
    });
    if (!venue) throw new NotFoundException('No such venue on this event');

    const dependents = venue._count.timeline + venue._count.tables;
    if (dependents > 0) {
      throw new BadRequestException(
        `${venue._count.timeline} timeline entr(ies) and ${venue._count.tables} table(s) ` +
          'still point at this venue; move them first',
      );
    }

    await this.prisma.venue.delete({ where: { id: venueId } });
    return { ok: true as const };
  }

  private async require(eventId: string, venueId: string) {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, eventId } });
    if (!venue) throw new NotFoundException('No such venue on this event');
    return venue;
  }

  private async requireProfile(profileId: string) {
    const profile = await this.prisma.venueProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('No such venue in the directory');
    return profile;
  }
}

function asVenueRole(value: string): VenueRole {
  if (!(value in VenueRole)) {
    throw new BadRequestException(
      `role must be one of ${Object.keys(VenueRole).join(', ')}`,
    );
  }
  return value as VenueRole;
}

/**
 * Coordinates and capacity are copied from the directory entry, not read
 * through it: a hall that moves next year must not rewrite the address on an
 * invitation already sent.
 */
function fromProfile(
  profile: { id: string; latitude: number | null; longitude: number | null; capacity: number | null } | null,
) {
  return {
    profileId: profile?.id ?? null,
    latitude: profile?.latitude ?? null,
    longitude: profile?.longitude ?? null,
    capacity: profile?.capacity ?? null,
  };
}
