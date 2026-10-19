import { buildInvitationContent } from './invitation-content';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isReadableByGuests } from './publishing';
import { AnalyticsService } from '../../infra/analytics/analytics.service';
import { CacheService, invitationCacheKey, invitationMetaKey, invitationGenerationKey } from '../../infra/cache/cache.service';
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
const GUEST_INCLUDE = {
  ...ATTENDANCE_GUEST,
  rsvp: true,
  event: { select: { seatingPublishedAt: true, ...ATTENDANCE_GUEST.event.select } },
  household: {
    include: {
      guests: {
        orderBy: { isPrimary: 'desc' },
        include: { ...ATTENDANCE_GUEST, seats: { include: SEAT_DETAIL } },
      },
    },
  },
} satisfies Prisma.GuestInclude;

type LoadedGuest = Prisma.GuestGetPayload<{ include: typeof GUEST_INCLUDE }>;


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

  /**
   * The hot path. One invitation link is opened by every guest, often in the
   * same few minutes after it is sent, and the payload is identical for every
   * guest reading the same language. It is cached per slug and locale and
   * dropped on any write that changes what the page renders.
   *
   * The personalized variant is NOT cached: it is per-guest by definition, and
   * caching it would multiply the keyspace by the guest count for no reuse.
   */
  async getCachedInvitation(slug: string, locale?: string) {
    const meta = await this.pageMeta(slug);
    // A PRIVATE event is reachable by personal link only (spec §13.1; D6,
    // 9 October 2026). Changing visibility invalidates the cache, so making
    // an event private closes its generic link at once.
    if (meta.visibility === EventVisibility.PRIVATE) {
      throw new NotFoundException(`Invitation "${slug}" is no longer available`);
    }
    // Bounds the cache keyspace to the locales this event publishes.
    const effectiveLocale = negotiateLocale(locale, meta.locales, meta.defaultLocale);
    const payload = await this.sharedPayload(slug, effectiveLocale);

    // Fire and forget: a guest's page must never wait on analytics.
    void this.analytics.recordInvitationView({ slug, eventId: meta.eventId, locale: effectiveLocale });
    return payload;
  }

  /**
   * The page personalized for one guest: greeted by name, in their language,
   * with their household's real seat allowance (spec §5.4).
   *
   * Built from the cached shared page plus one query for the guest — the
   * personal link is what every email carries, so it is most of the traffic,
   * and rebuilding the whole page per guest cost some fourteen queries.
   */
  async getPublicInvitation(slug: string, guestToken?: string, requestedLocale?: string) {
    const meta = await this.pageMeta(slug);
    const guest = guestToken ? await this.findGuest(guestToken, meta.eventId) : null;
    // A personal link must belong to a guest. Served with `guest: null`, any
    // made-up token opened a PRIVATE event's page — its generic URL with
    // extra steps. Same answer as an unknown slug, so a token is not probeable.
    if (guestToken && !guest) throw new NotFoundException(`Invitation "${slug}" is no longer available`);
    if (!guest) return this.getCachedInvitation(slug, requestedLocale);

    // A language the guest picks on the page wins, if the event publishes it;
    // otherwise their own. Picking one does not change their stored language.
    // Negotiated like the shared page: `en-GB` reaches `en`.
    const asked = requestedLocale ? negotiateLocale(requestedLocale, meta.locales, '') : '';
    const locale = negotiateLocale(asked || (guest.locale ?? undefined), meta.locales, meta.defaultLocale);
    const payload = await this.sharedPayload(slug, locale);

    void this.analytics.recordInvitationView({ slug, eventId: meta.eventId, locale, guestId: guest.id });
    return { ...payload, guest: this.buildGuestView(guest, guest.event.seatingPublishedAt !== null, locale) };
  }

  /**
   * Who may read the page and in which languages, cached beside it. A hit on
   * the page used to load the invitation, its blocks, event, venues and
   * timeline from Postgres first, only to decide the cache key.
   */
  private pageMeta(slug: string) {
    return this.cache.readThrough(invitationMetaKey(slug), this.cacheTtlSeconds, async () => {
      const invitation = await this.prisma.invitation.findUnique({
        where: { slug },
        select: { status: true, event: { select: { id: true, locales: true, defaultLocale: true, visibility: true } } },
      });
      if (!invitation || !isReadableByGuests(invitation.status)) {
        throw new NotFoundException(`Invitation "${slug}" is no longer available`);
      }
      const { event } = invitation;
      return { eventId: event.id, locales: event.locales, defaultLocale: event.defaultLocale, visibility: event.visibility };
    }, invitationGenerationKey(slug));
  }

  /** The page as every guest reading this language sees it, cached per slug and locale. */
  private sharedPayload(slug: string, locale: string) {
    return this.cache.readThrough(
      invitationCacheKey(slug, locale),
      this.cacheTtlSeconds,
      async () => this.buildPayload(await this.loadPublished(slug), null, locale),
      invitationGenerationKey(slug),
    );
  }

  private buildPayload(
    invitation: LoadedInvitation,
    guest: LoadedGuest | null,
    requestedLocale?: string,
  ) {
    const payload = buildInvitationContent(invitation, requestedLocale);
    return { ...payload, guest: guest ? this.buildGuestView(guest, guest.event.seatingPublishedAt !== null, payload.locale) : null };
  }

  private async loadPublished(slug: string): Promise<LoadedInvitation> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { slug },
      include: invitationInclude,
    });

    if (!invitation || !isReadableByGuests(invitation.status)) {
      throw new NotFoundException(`No published invitation at "${slug}"`);
    }
    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
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
      // Opening the bot from here opts them in to reminders on Telegram. Their
      // own token, so it links this guest; null when no bot is configured.
      telegramLink: this.botUsername ? `https://t.me/${this.botUsername}?start=${guest.token}` : null,
    };
  }

  private findGuest(token: string, eventId: string) {
    return this.prisma.guest.findFirst({
      where: { token, eventId },
      include: GUEST_INCLUDE,
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
