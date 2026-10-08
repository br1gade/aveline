import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isReadableByGuests } from './publishing';
import { AnalyticsService } from '../../infra/analytics/analytics.service';
import { CacheService, invitationCacheKey } from '../../infra/cache/cache.service';
import { negotiateLocale, resolveTranslation } from '../../common/locale';

const invitationInclude = {
  template: true,
  blocks: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } },
  questions: { orderBy: { sortOrder: 'asc' } },
  event: {
    include: {
      venues: { orderBy: { sortOrder: 'asc' } },
      timeline: { orderBy: { occursAt: 'asc' } },
    },
  },
} satisfies Prisma.InvitationInclude;

type LoadedInvitation = Prisma.InvitationGetPayload<{ include: typeof invitationInclude }> & {
  /** The uploads its enabled blocks show, by id. */
  media: Map<string, BlockMedia>;
};
type LoadedEvent = LoadedInvitation['event'];
type LoadedBlock = LoadedInvitation['blocks'][number];

const blockMediaSelect = { id: true, url: true, kind: true, altText: true } satisfies Prisma.MediaAssetSelect;
type BlockMedia = Prisma.MediaAssetGetPayload<{ select: typeof blockMediaSelect }>;
type LoadedGuest = Prisma.GuestGetPayload<{
  include: { rsvp: true; household: { include: { guests: true } } };
}>;

/** Resolves a translated field for one request's locale. */
type Translate = <T>(content: unknown) => T | null;

@Injectable()
export class InvitationsService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly analytics: AnalyticsService,
    config: ConfigService,
  ) {
    this.cacheTtlSeconds = Number(config.get<string>('INVITATION_CACHE_TTL') ?? 300);
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
    const published = await this.loadPublished(slug);
    // Bounds the cache keyspace to the locales this event publishes.
    const effectiveLocale = negotiateLocale(
      locale,
      published.event.locales,
      published.event.defaultLocale,
    );

    const payload = await this.cache.readThrough(
      invitationCacheKey(slug, effectiveLocale),
      this.cacheTtlSeconds,
      () => Promise.resolve(this.buildPayload(published, null, effectiveLocale)),
    );

    // Fire and forget: a guest's page must never wait on analytics.
    void this.analytics.recordInvitationView({
      slug,
      eventId: published.event.id,
      locale: effectiveLocale,
    });

    return payload;
  }

  /**
   * The public invitation payload. Blocks are data-bound: VENUE, TIMELINE and
   * COUNTDOWN hold no duplicated copy of the event's data, they are hydrated
   * here from the Event itself. That is what makes one edit propagate
   * everywhere at once (spec §3, §5.1).
   *
   * With `guestToken` the page is personalized: greeted by name, rendered in
   * the guest's language, showing their household's real seat allowance
   * (spec §5.4).
   */
  async getPublicInvitation(slug: string, guestToken?: string) {
    const invitation = await this.loadPublished(slug);
    const guest = guestToken ? await this.findGuest(guestToken, invitation.event.id) : null;

    if (guest) {
      void this.analytics.recordInvitationView({
        slug,
        eventId: invitation.event.id,
        locale: guest.locale ?? invitation.event.defaultLocale,
        guestId: guest.id,
      });
    }

    return this.buildPayload(invitation, guest, guest?.locale ?? undefined);
  }

  private buildPayload(
    invitation: LoadedInvitation,
    guest: LoadedGuest | null,
    requestedLocale?: string,
  ) {
    const { event } = invitation;
    const locale = negotiateLocale(requestedLocale, event.locales, event.defaultLocale);
    const translate: Translate = (content) => resolveTranslation(content, locale, event.defaultLocale);

    return {
      slug: invitation.slug,
      // Whether to show the RSVP form at all. A closed invitation is still
      // readable — the venue and time still matter to people who are coming —
      // so the page needs to know not to offer a form that will be refused.
      isAcceptingResponses: isAcceptingResponses(invitation, new Date()),
      template: invitation.template.key,
      // The host's choices layered over the template's defaults, so a partially
      // configured invitation still renders with a complete token set.
      theme: { ...asRecord(invitation.template.defaultTheme), ...asRecord(invitation.theme) },
      allowedFonts: invitation.template.allowedFonts,
      // Derived from the blocks rather than stored beside them, so there is
      // one place a host sets each: the hero's first photo is the cover, and
      // switching the music block off silences the page.
      musicUrl: firstMediaUrl(invitation, BlockType.MUSIC),
      coverUrl: firstMediaUrl(invitation, BlockType.HERO),
      locale,
      availableLocales: event.locales,
      event: this.buildEventView(event),
      guest: guest ? this.buildGuestView(guest) : null,
      blocks: invitation.blocks.map((block) => ({
        type: block.type,
        sortOrder: block.sortOrder,
        variant: block.variant,
        settings: block.settings,
        content: translate(block.content) ?? {},
        media: mediaFor(block, invitation.media, translate),
        data: this.hydrateBlock(block.type, event, translate),
      })),
      rsvpQuestions: invitation.questions.map((question) => ({
        id: question.id,
        type: question.type,
        required: question.required,
        prompt: translate(question.prompt),
        options: translate(question.options) ?? [],
      })),
    };
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
    return { ...invitation, media: await this.loadBlockMedia(invitation) };
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

  private buildEventView(event: LoadedEvent) {
    return {
      type: event.type,
      title: event.title,
      hosts: event.hostsLabel,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      sides: { a: event.sideALabel, b: event.sideBLabel },
    };
  }

  private buildGuestView(guest: LoadedGuest) {
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
        })),
      },
      rsvp: guest.rsvp && { status: guest.rsvp.status, respondedAt: guest.rsvp.respondedAt },
    };
  }

  /** Pulls live Event data for the block types that must never duplicate it. */
  private hydrateBlock(type: BlockType, event: LoadedEvent, translate: Translate): unknown {
    switch (type) {
      case BlockType.VENUE:
      case BlockType.MAP:
        return event.venues.map((venue) => ({
          role: venue.role,
          name: venue.name,
          address: venue.address,
          latitude: venue.latitude,
          longitude: venue.longitude,
          mapUrl: venue.mapUrl,
          arriveAt: venue.arriveAt,
        }));
      case BlockType.TIMELINE:
        return event.timeline.map((entry) => ({
          label: translate(entry.label),
          occursAt: entry.occursAt,
          venueId: entry.venueId,
        }));
      case BlockType.COUNTDOWN:
        return { target: event.startsAt, timezone: event.timezone };
      default:
        return null;
    }
  }

  private findGuest(token: string, eventId: string) {
    return this.prisma.guest.findFirst({
      where: { token, eventId },
      include: {
        rsvp: true,
        household: { include: { guests: { orderBy: { isPrimary: 'desc' } } } },
      },
    });
  }
}

/** A block's uploads in the host's order, skipping any since removed. */
function mediaFor(block: LoadedBlock, media: Map<string, BlockMedia>, translate: Translate) {
  return block.assetIds.flatMap((id) => {
    const asset = media.get(id);
    if (!asset) return [];
    return [{ id: asset.id, url: asset.url, kind: asset.kind, altText: translate<string>(asset.altText) }];
  });
}

/** The first upload on an enabled block of this type, or null. */
function firstMediaUrl(invitation: LoadedInvitation, type: BlockType): string | null {
  const block = invitation.blocks.find((candidate) => candidate.type === type);
  const firstId = block?.assetIds.find((id) => invitation.media.has(id));
  return firstId ? (invitation.media.get(firstId)?.url ?? null) : null;
}

function fullName(person: { firstName: string; lastName: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Open for new answers: published, and not past its expiry.
 *
 * Computed into a cached payload, so an expiry passing mid-cache can briefly
 * show the form after it has closed. The RSVP endpoint enforces the same rule
 * independently, so the worst case is a form that says "this invitation has
 * closed" when submitted — never an answer accepted after the deadline.
 */
function isAcceptingResponses(
  invitation: { status: string; expiresAt: Date | null },
  now: Date,
): boolean {
  if (invitation.status !== 'PUBLISHED') return false;
  return invitation.expiresAt === null || invitation.expiresAt > now;
}
