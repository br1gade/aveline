import { Injectable, NotFoundException } from '@nestjs/common';
import { BlockType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveTranslation } from '../../common/locale';

const invitationInclude = {
  blocks: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } },
  questions: { orderBy: { sortOrder: 'asc' } },
  event: {
    include: {
      venues: { orderBy: { sortOrder: 'asc' } },
      timeline: { orderBy: { occursAt: 'asc' } },
    },
  },
} satisfies Prisma.InvitationInclude;

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The public invitation payload. Blocks are data-bound: VENUE, TIMELINE and
   * COUNTDOWN carry no duplicated copy of the event's data, they are hydrated
   * here from the Event itself. That is what makes an edit propagate everywhere
   * at once (spec §3, §5.1).
   *
   * When `guestToken` is supplied the page is personalized: the guest is
   * greeted by name, rendered in their language, and told how many seats their
   * household actually has (spec §5.4).
   */
  async getPublicInvitation(slug: string, guestToken?: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { slug },
      include: invitationInclude,
    });

    if (!invitation || invitation.status !== 'PUBLISHED') {
      throw new NotFoundException(`No published invitation at "${slug}"`);
    }
    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      throw new NotFoundException(`Invitation "${slug}" is no longer available`);
    }

    const { event } = invitation;
    const guest = guestToken ? await this.findGuest(guestToken, event.id) : null;
    const locale = guest?.locale ?? event.defaultLocale;
    const t = <T>(c: unknown) => resolveTranslation<T>(c, locale, event.defaultLocale);

    return {
      slug: invitation.slug,
      template: invitation.template,
      theme: invitation.theme,
      musicUrl: invitation.musicUrl,
      coverUrl: invitation.coverUrl,
      locale,
      availableLocales: event.locales,
      event: {
        type: event.type,
        title: event.title,
        hosts: event.hostsLabel,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        sides: { a: event.sideALabel, b: event.sideBLabel },
      },
      guest: guest && {
        id: guest.id,
        name: [guest.firstName, guest.lastName].filter(Boolean).join(' '),
        locale: guest.locale,
        household: {
          name: guest.household.name,
          seatsAllotted: guest.household.seatsAllotted,
          members: guest.household.guests.map((g) => ({
            id: g.id,
            name: [g.firstName, g.lastName].filter(Boolean).join(' '),
          })),
        },
        rsvp: guest.rsvp && {
          status: guest.rsvp.status,
          respondedAt: guest.rsvp.respondedAt,
        },
      },
      blocks: invitation.blocks.map((block) => ({
        type: block.type,
        sortOrder: block.sortOrder,
        settings: block.settings,
        content: t(block.content) ?? {},
        // Data-bound hydration — never duplicated into block content.
        data: this.hydrateBlock(block.type, event, t),
      })),
      rsvpQuestions: invitation.questions.map((q) => ({
        id: q.id,
        type: q.type,
        required: q.required,
        prompt: t(q.prompt),
        options: t(q.options) ?? [],
      })),
    };
  }

  private hydrateBlock(
    type: BlockType,
    event: Prisma.EventGetPayload<{ include: { venues: true; timeline: true } }>,
    t: <T>(c: unknown) => T | null,
  ): unknown {
    switch (type) {
      case BlockType.VENUE:
      case BlockType.MAP:
        return event.venues.map((v) => ({
          role: v.role,
          name: v.name,
          address: v.address,
          latitude: v.latitude,
          longitude: v.longitude,
          mapUrl: v.mapUrl,
          arriveAt: v.arriveAt,
        }));
      case BlockType.TIMELINE:
        return event.timeline.map((e) => ({
          label: t(e.label),
          occursAt: e.occursAt,
          venueId: e.venueId,
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
