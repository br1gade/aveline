import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VenueRole, type VenueTicketLayoutVersion } from '@prisma/client';
import { lockRow } from '../../common/row-lock';
import { lockCurrentUsers, lockEventOrganization, requireCurrentEventPermission } from '../../infra/auth/access-locks';
import { can } from '../access/access-policy';
import { lockLiveEvent } from '../events/event-lock';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_VENUE_LAYOUTS, PublishVenueTicketLayoutDto } from './dto/venue-ticket-layout.dto';
import { normalizeTicketLayout, type TicketLayoutSection } from './venue-ticket-layout-definition';

interface EventVenue { eventId: string; venueId: string }

@Injectable()
export class VenueTicketLayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(profileId: string, dto: PublishVenueTicketLayoutDto, userId: string) {
    const sections = normalizeTicketLayout(dto.sections);
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'venue_profiles', profileId);
      await requireDirectoryEditor(tx, userId);
      if (!await tx.venueProfile.findFirst({ where: { id: profileId, isActive: true }, select: { id: true } })) {
        throw new NotFoundException('No such active venue profile');
      }
      const latest = await tx.venueTicketLayoutVersion.findFirst({
        where: { profileId, key: dto.key }, orderBy: { version: 'desc' }, select: { version: true },
      });
      if ((latest?.version ?? 0) !== dto.expectedVersion) throw new ConflictException('expectedVersion: the layout changed; reload it');
      if (!latest) await assertCatalogueSpace(tx, profileId);
      return describe(await tx.venueTicketLayoutVersion.create({
        data: { profileId, key: dto.key, name: dto.name, version: dto.expectedVersion + 1, sections },
      }));
    });
  }

  async list(target: EventVenue) {
    const venue = await requireVenue(this.prisma, target);
    if (!venue.profile?.isActive) return [];
    return this.prisma.$queryRaw<LayoutSummary[]>`
      SELECT DISTINCT ON ("key") id, "key", name, version
      FROM venue_ticket_layout_versions WHERE "profileId" = ${venue.profileId}
      ORDER BY "key", version DESC LIMIT ${MAX_VENUE_LAYOUTS}`;
  }

  async preview(target: EventVenue, versionId: string) {
    const venue = await requireVenue(this.prisma, target);
    return describe(await requireVersion(this.prisma, venue.profileId, versionId));
  }

  async current(target: EventVenue) {
    const venue = await requireVenue(this.prisma, target);
    if (!venue.ticketLayoutVersionId) return null;
    return describe(await this.prisma.venueTicketLayoutVersion.findUniqueOrThrow({ where: { id: venue.ticketLayoutVersionId } }));
  }

  async select(target: EventVenue, versionId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockEventOrganization(tx, target.eventId);
      await lockLiveEvent(tx, target.eventId);
      await requireCurrentEventPermission(tx, { actor: { userId }, eventId: target.eventId, permission: 'event:write' });
      await lockRow(tx, 'venues', target.venueId);
      const venue = await requireVenue(tx, target);
      if (venue.role === VenueRole.PREPARATION) throw new BadRequestException('venueId: choose a guest-facing venue');
      if (venue.profileId) await lockRow(tx, 'venue_profiles', venue.profileId);
      const version = await requireVersion(tx, venue.profileId, versionId);
      await tx.venue.update({ where: { id: venue.id }, data: { ticketLayoutVersionId: version.id } });
      return describe(version);
    });
  }
}

type LayoutSummary = Pick<VenueTicketLayoutVersion, 'id' | 'key' | 'name' | 'version'>;

async function requireVenue(tx: Prisma.TransactionClient, { eventId, venueId }: EventVenue) {
  const venue = await tx.venue.findFirst({
    where: { id: venueId, eventId }, select: { id: true, profileId: true, role: true,
      ticketLayoutVersionId: true, profile: { select: { isActive: true } } },
  });
  if (!venue) throw new NotFoundException('No such venue on this event');
  return venue;
}

async function requireVersion(tx: Prisma.TransactionClient, profileId: string | null, id: string) {
  const version = profileId && await tx.venueTicketLayoutVersion.findFirst({ where: { id, profileId, profile: { isActive: true } } });
  if (!version) throw new NotFoundException('No such layout version for this venue');
  return version;
}

async function requireDirectoryEditor(tx: Prisma.TransactionClient, userId: string) {
  await lockCurrentUsers(tx, [userId]);
  const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true, platformRole: true } });
  if (!user?.isActive || !can({ kind: 'staff', role: user.platformRole }, 'directory:manage')) {
    throw new ForbiddenException('Directory editing permission is no longer available');
  }
}

async function assertCatalogueSpace(tx: Prisma.TransactionClient, profileId: string) {
  const [{ count }] = await tx.$queryRaw<{ count: number }[]>`
    SELECT COUNT(DISTINCT "key")::int AS count FROM venue_ticket_layout_versions WHERE "profileId" = ${profileId}`;
  if (count >= MAX_VENUE_LAYOUTS) throw new ConflictException('key: this venue has reached its layout limit');
}

function describe({ id, profileId, key, name, version, sections }: VenueTicketLayoutVersion) {
  return { id, profileId, key, name, version, sections: sections as unknown as TicketLayoutSection[] };
}
