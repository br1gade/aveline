import { GuestPageMeta, readGuestPageMeta } from './guest-page-version';
import { hasInvitationExpired } from './lifetime';
import { buildInvitationContent } from './invitation-content';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isReadableByGuests } from './publishing';
import { AnalyticsService } from '../../infra/analytics/analytics.service';
import { CacheService, invitationCacheKey } from '../../infra/cache/cache.service';
import { ATTENDANCE_GUEST, attendanceView } from '../rsvp/attendance/attendance-view';
import { GUEST_FACING_VENUES } from '../design/guest-facing-venues';
import { SEAT_DETAIL, seatingAssignments, singleTable } from '../seating/seat-view';
import { negotiateLocale } from '../../common/locale';

export const invitationInclude = {
  template: true,
  blocks: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } },
  questions: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  event: {
    include: {
      venues: { where: GUEST_FACING_VENUES, orderBy: { sortOrder: 'asc' } },
      // Entries marked internal are for the people running the day, not guests.
      // The host's order breaks ties at the same minute, as on their own list.
      timeline: { where: { isInternal: false }, orderBy: [{ occursAt: 'asc' }, { sortOrder: 'asc' }] },
    },
  },
} satisfies Prisma.InvitationInclude;

type LoadedInvitation = Prisma.InvitationGetPayload<{ include: typeof invitationInclude }> & {
  /** The uploads its enabled blocks show, by id. */
  media: Map<string, BlockMedia>;
};

export const blockMediaSelect = {
  id: true,
  url: true,
  kind: true,
  altText: true,
  width: true,
  height: true,
  variants: true,
} satisfies Prisma.MediaAssetSelect;
type BlockMedia = Prisma.MediaAssetGetPayload<{ select: typeof blockMediaSelect }>;
const GUEST_SELECT = {
  id: true, firstName: true, lastName: true, locale: true,
  ...ATTENDANCE_GUEST,
  rsvp: { select: { status: true, respondedAt: true } },
  event: { select: { seatingPublishedAt: true, ...ATTENDANCE_GUEST.event.select } },
  household: {
    select: {
      name: true, seatsAllotted: true,
      guests: {
        where: { anonymizedAt: null },
        orderBy: { isPrimary: 'desc' },
        select: { id: true, firstName: true, lastName: true, ...ATTENDANCE_GUEST, seats: { include: SEAT_DETAIL } },
      },
    },
  },
} satisfies Prisma.GuestSelect;

type LoadedGuest = Prisma.GuestGetPayload<{ select: typeof GUEST_SELECT }>;


@Injectable()
export class InvitationsService {
  private readonly cacheTtlSeconds: number;
  private readonly botUsername: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly analytics: AnalyticsService,
    config: ConfigService,
  ) {
    this.cacheTtlSeconds = Number(config.get<string>('INVITATION_CACHE_TTL') ?? 300);
    this.botUsername = config.get<string>('TELEGRAM_BOT_USERNAME') ?? '';
  }

  async getCachedInvitation(slug: string, locale?: string) {
    return this.servePage(slug, undefined, locale);
  }

  async getPublicInvitation(slug: string, guestToken?: string, requestedLocale?: string) {
    return this.servePage(slug, guestToken, requestedLocale);
  }

  private async servePage(slug: string, token?: string, requestedLocale?: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const meta = await this.pageMeta(slug, token);
      const asked = requestedLocale ? negotiateLocale(requestedLocale, meta.locales, '') : '';
      const locale = negotiateLocale(asked || (meta.guestLocale ?? undefined), meta.locales, meta.defaultLocale);
      const [payload, guest] = await Promise.all([this.sharedPayload(slug, locale, meta),
        meta.guestId ? this.personalPayload(meta, locale) : Promise.resolve(null)]);
      const current = await this.pageMeta(slug, token);
      if (!isSamePage(meta, current)) continue;
      void this.analytics.recordInvitationView({ slug, eventId: meta.eventId, locale, guestId: meta.guestId ?? undefined });
      return { ...payload, guest: guest ? { ...guest, telegramLink: this.botUsername ? `https://t.me/${this.botUsername}?start=${token!}` : null } : null };
    }
    throw new ConflictException('Invitation changed while loading; please retry');
  }

  private async pageMeta(slug: string, token?: string) {
    const [meta] = await readGuestPageMeta(this.prisma, slug, token);
    const isDenied = !meta || !isReadableByGuests(meta.status) || hasInvitationExpired(meta)
      || (token ? !meta.guestId : meta.visibility === EventVisibility.PRIVATE);
    if (isDenied) throw new NotFoundException(`Invitation "${slug}" is no longer available`);
    return meta;
  }

  private sharedPayload(slug: string, locale: string, meta: GuestPageMeta) {
    return this.cache.readThrough(`${invitationCacheKey(slug, locale)}:v2:${meta.eventId}:${meta.revision}`, this.cacheTtlSeconds,
      async () => buildInvitationContent(await this.loadPublished(slug), locale));
  }

  private personalPayload(meta: GuestPageMeta, locale: string) {
    const key = `aveline:personal:v1:${meta.eventId}:${meta.guestId!}:${locale}:${meta.revision}`;
    return this.cache.readThrough(key, Math.min(this.cacheTtlSeconds, 300), async () => {
      const guest = await this.findGuest(meta.guestId!, meta.eventId);
      if (!guest) throw new NotFoundException('Invitation is no longer available');
      return this.buildGuestView(guest, guest.event.seatingPublishedAt !== null, locale);
    });
  }

  private async loadPublished(slug: string): Promise<LoadedInvitation> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { slug },
      include: invitationInclude,
    });

    if (!invitation || !isReadableByGuests(invitation.status)) {
      throw new NotFoundException(`No published invitation at "${slug}"`);
    }
    if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
      throw new NotFoundException(`Invitation "${slug}" is no longer available`);
    }
    const media = await this.loadBlockMedia(invitation);
    return { ...invitation, media };
  }

  /**
   * Every upload the page shows, in one query rather than one per block.
   *
   * Scoped to the event as well as by id: attaching already refuses another
   * event's asset, and this keeps a row that slipped past it off the page.
   */
  private async loadBlockMedia(invitation: {
    eventId: string;
    blocks: { assetIds: string[] }[];
  }): Promise<Map<string, BlockMedia>> {
    const ids = [...new Set(invitation.blocks.flatMap((block) => block.assetIds))];
    if (ids.length === 0) return new Map();

    const assets = await this.prisma.mediaAsset.findMany({
      where: { id: { in: ids }, eventId: invitation.eventId },
      select: blockMediaSelect,
    });
    return new Map(assets.map((asset) => [asset.id, asset]));
  }

  private buildGuestView(guest: LoadedGuest, isSeatingPublished: boolean, locale: string) {
    return {
      id: guest.id,
      name: fullName(guest),
      locale: guest.locale,
      household: {
        name: guest.household.name,
        seatsAllotted: guest.household.seatsAllotted,
        members: guest.household.guests.map((member) => ({
          id: member.id,
          name: fullName(member),
          attendance: attendanceView(member, locale),
        })),
      },
      attendance: attendanceView(guest, locale),
      rsvp: guest.rsvp && { status: guest.rsvp.status, respondedAt: guest.rsvp.respondedAt },
      // Decision D4: their own household's tables, on their own link, once the
      // host publishes — never the room, never on the shared page.
      seating: isSeatingPublished ? seatingFor(guest, locale) : null,
    };
  }

  private findGuest(id: string, eventId: string) {
    return this.prisma.guest.findFirst({
      where: { id, eventId, anonymizedAt: null },
      select: GUEST_SELECT,
    });
  }
}

function fullName(person: { firstName: string; lastName: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

/** Where this guest and the people they came with are sitting; `null` for no table yet. */
function seatingFor(guest: LoadedGuest, locale: string) {
  const visibleVenueIds = new Set(guest.event.venues.map((venue) => venue.id));
  const visibleSeats = (member: LoadedGuest['household']['guests'][number]) => member.seats.filter(
    (seat) => seat.table.venueId === null || visibleVenueIds.has(seat.table.venueId),
  );
  const tableOf = (member: LoadedGuest['household']['guests'][number]) => singleTable(visibleSeats(member));
  const own = guest.household.guests.find((member) => member.id === guest.id);
  return {
    table: own ? tableOf(own) : null,
    assignments: own ? seatingAssignments(visibleSeats(own), locale) : [],
    household: guest.household.guests.map((member) => ({
      id: member.id, name: fullName(member), table: tableOf(member), assignments: seatingAssignments(visibleSeats(member), locale),
    })),
  };
}

function isSamePage(before: GuestPageMeta, after: GuestPageMeta): boolean {
  return before.eventId === after.eventId && before.guestId === after.guestId && before.revision === after.revision;
}
