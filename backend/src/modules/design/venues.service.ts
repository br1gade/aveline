import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VenueRole } from '@prisma/client';
import { VENUE_TRANSLATABLE, translationsProblem } from '../../common/field-translations';
import { CacheService } from '../../infra/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { countInvitedHouseholds } from '../invitations/sending/audience';
import { CreateVenueDto, CreateVenueProfileDto, UpdateVenueDto, UpdateVenueProfileDto } from './dto/design.dto';
import { mergeTranslations } from './translated-content';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

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
        translations: true,
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
    assertTranslations(dto.translations);
    assertCoordinatePair(dto.latitude, dto.longitude);
    const role = asVenueRole(dto.role);
    const profile = dto.profileId ? await this.requireProfile(dto.profileId) : null;

    const last = await this.prisma.venue.findFirst({
      where: { eventId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const venue = await this.prisma.venue.create({
      data: {
        eventId,
        role,
        name: dto.name,
        address: dto.address,
        mapUrl: dto.mapUrl ?? null,
        arriveAt: dto.arriveAt ? new Date(dto.arriveAt) : null,
        translations: mergeTranslations({}, dto.translations ?? {}) as Prisma.InputJsonValue,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        ...fromProfile(profile),
        // What the host typed wins over the directory's copy.
        ...withoutUndefined({ latitude: dto.latitude, longitude: dto.longitude, capacity: dto.capacity }),
      },
    });
    return { ...venue, notice: await this.afterChange(eventId) };
  }

  async update(eventId: string, venueId: string, dto: UpdateVenueDto) {
    assertTranslations(dto.translations);
    const current = await this.require(eventId, venueId);
    assertCoordinatePair(
      dto.latitude === undefined ? current.latitude : dto.latitude,
      dto.longitude === undefined ? current.longitude : dto.longitude,
    );

    const venue = await this.prisma.venue.update({
      where: { id: venueId },
      data: {
        role: dto.role === undefined ? undefined : asVenueRole(dto.role),
        name: dto.name ?? undefined,
        address: dto.address ?? undefined,
        // Omitted leaves these alone; null clears them.
        mapUrl: dto.mapUrl,
        arriveAt: dto.arriveAt ? new Date(dto.arriveAt) : dto.arriveAt,
        latitude: dto.latitude,
        longitude: dto.longitude,
        capacity: dto.capacity,
        translations: dto.translations
          ? (mergeTranslations(current.translations, dto.translations) as Prisma.InputJsonValue)
          : undefined,
      },
    });
    return { ...venue, notice: await this.afterChange(eventId) };
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
    return { ok: true as const, notice: await this.afterChange(eventId) };
  }

  // ── the shared directory ────────────────────────────────────────────

  /** A hall in the directory every host copies from. Aveline staff only. */
  createProfile(dto: CreateVenueProfileDto) {
    assertCoordinatePair(dto.latitude, dto.longitude);
    return this.prisma.venueProfile.create({ data: { ...dto } });
  }

  /** Corrects a hall, or retires it. Venues already copied from it keep their copy. */
  async updateProfile(profileId: string, dto: UpdateVenueProfileDto) {
    const current = await this.requireProfile(profileId, { includeRetired: true });
    assertCoordinatePair(
      dto.latitude === undefined ? current.latitude : dto.latitude,
      dto.longitude === undefined ? current.longitude : dto.longitude,
    );
    return this.prisma.venueProfile.update({ where: { id: profileId }, data: { ...dto } });
  }

  /**
   * What every venue change owes the people holding the invitation.
   *
   * The cached page is dropped — it used not to be, so a corrected address
   * stayed wrong for guests on the generic link for minutes. And when
   * someone was invited, the host is offered to tell them (decided 8 October
   * 2026); sending is their separate, deliberate call.
   */
  private async afterChange(eventId: string) {
    const invitation = await this.prisma.invitation.findUnique({ where: { eventId }, select: { slug: true } });
    if (invitation) await this.cache.invalidateInvitation(invitation.slug);

    const householdsInvited = await countInvitedHouseholds(this.prisma, eventId);
    return { isSuggested: householdsInvited > 0, changed: ['venues'], householdsInvited };
  }

  private async require(eventId: string, venueId: string) {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, eventId } });
    if (!venue) throw new NotFoundException('No such venue on this event');
    return venue;
  }

  /** A hall in the directory. A retired one is not offered to hosts. */
  private async requireProfile(profileId: string, options = { includeRetired: false }) {
    const profile = await this.prisma.venueProfile.findFirst({
      where: { id: profileId, ...(options.includeRetired ? {} : { isActive: true }) },
    });
    if (!profile) throw new NotFoundException('No such venue in the directory');
    return profile;
  }
}

function asVenueRole(value: string): VenueRole {
  // Not `value in VenueRole`: that also matches "constructor" and the other
  // properties every object inherits, which then failed in the database as a 500.
  if (!(Object.values(VenueRole) as string[]).includes(value)) {
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

function assertTranslations(translations: Record<string, unknown> | undefined): void {
  const problem = translations ? translationsProblem(translations, VENUE_TRANSLATABLE) : null;
  if (problem) throw new BadRequestException(problem);
}

/** A point on the map needs both halves; half a coordinate is a pin in the sea. */
function assertCoordinatePair(latitude: number | null | undefined, longitude: number | null | undefined): void {
  const hasLatitude = latitude !== null && latitude !== undefined;
  const hasLongitude = longitude !== null && longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    throw new BadRequestException(`${hasLatitude ? 'latitude' : 'longitude'}: give latitude and longitude together`);
  }
}

function withoutUndefined<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;
}
