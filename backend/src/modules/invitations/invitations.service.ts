import { Injectable, NotFoundException } from '@nestjs/common';
import { BlockType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveTranslation } from '../../common/locale';

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

type LoadedInvitation = Prisma.InvitationGetPayload<{ include: typeof invitationInclude }>;
type LoadedEvent = LoadedInvitation['event'];
type LoadedGuest = Prisma.GuestGetPayload<{
  include: { rsvp: true; household: { include: { guests: true } } };
}>;

/** Resolves a translated field for one request's locale. */
type Translate = <T>(content: unknown) => T | null;

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const { event } = invitation;

    const guest = guestToken ? await this.findGuest(guestToken, event.id) : null;
    const locale = guest?.locale ?? event.defaultLocale;
    const translate: Translate = (content) => resolveTranslation(content, locale, event.defaultLocale);

    return {
      slug: invitation.slug,
      template: invitation.template.key,
      // The host's choices layered over the template's defaults, so a partially
      // configured invitation still renders with a complete token set.
      theme: { ...asRecord(invitation.template.defaultTheme), ...asRecord(invitation.theme) },
      allowedFonts: invitation.template.allowedFonts,
      musicUrl: invitation.musicUrl,
      coverUrl: invitation.coverUrl,
      locale,
      availableLocales: event.locales,
      event: this.buildEventView(event),
      guest: guest ? this.buildGuestView(guest) : null,
      blocks: invitation.blocks.map((block) => ({
        type: block.type,
        sortOrder: block.sortOrder,
        settings: block.settings,
        content: translate(block.content) ?? {},
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

    if (!invitation || invitation.status !== 'PUBLISHED') {
      throw new NotFoundException(`No published invitation at "${slug}"`);
    }
    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      throw new NotFoundException(`Invitation "${slug}" is no longer available`);
    }
    return invitation;
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

function fullName(person: { firstName: string; lastName: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
