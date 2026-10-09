import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, InvitationStatus } from '@prisma/client';
import { CacheService } from '../../infra/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { canTransition, publishBlockers } from './publishing';

/**
 * Making an invitation live, and stopping responses to it.
 *
 * Until this existed nothing in the codebase ever set an invitation to
 * PUBLISHED. A host could create an event and design it, and `send` would
 * then refuse with "publish it before sending" — with no way to publish. Every
 * test passed because the fixtures seeded PUBLISHED directly.
 */
@Injectable()
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Publishes, once the page is ready.
   *
   * Also marks the event itself PUBLISHED, because that is the state the
   * public listing filters on: without it a public event could never appear,
   * whatever happened to its invitation.
   */
  async publish(slug: string) {
    const invitation = await this.load(slug);
    assertNotArchived(invitation.event.status);
    this.assertCanMove(invitation.status, InvitationStatus.PUBLISHED);

    if (invitation.status === InvitationStatus.DRAFT) {
      const blockers = publishBlockers(
        {
          status: invitation.status,
          startsAt: invitation.event.startsAt,
          blocks: invitation.blocks,
          venues: invitation.event.venues,
        },
        new Date(),
      );
      // A list, so a form can mark every problem in one round trip.
      if (blockers.length > 0) throw new BadRequestException(blockers);
    }

    return this.move(invitation, InvitationStatus.PUBLISHED);
  }

  /**
   * Stops new responses. The page stays readable, because the people who are
   * coming still need the venue, the time and the dress code.
   */
  async close(slug: string) {
    const invitation = await this.load(slug);
    this.assertCanMove(invitation.status, InvitationStatus.CLOSED);
    return this.move(invitation, InvitationStatus.CLOSED);
  }

  /** Reopening is publishing again, without re-checking a page already live. */
  async reopen(slug: string) {
    const invitation = await this.load(slug);
    assertNotArchived(invitation.event.status);
    this.assertCanMove(invitation.status, InvitationStatus.PUBLISHED);
    return this.move(invitation, InvitationStatus.PUBLISHED);
  }

  /**
   * The move itself, conditioned on the status it was read in.
   *
   * Two hosts pressing publish and close at the same moment must not both
   * succeed: the update only matches if nobody else moved it first.
   */
  private async move(
    invitation: { id: string; slug: string; status: InvitationStatus; eventId: string },
    to: InvitationStatus,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.invitation.updateMany({
        where: { id: invitation.id, status: invitation.status },
        data: { status: to },
      });
      if (moved.count === 0) {
        throw new ConflictException('Someone else changed this invitation just now; reload it');
      }

      if (to === InvitationStatus.PUBLISHED) {
        await tx.event.updateMany({
          where: { id: invitation.eventId, status: EventStatus.DRAFT },
          data: { status: EventStatus.PUBLISHED },
        });
      }

      return tx.invitation.findUniqueOrThrow({
        where: { id: invitation.id },
        select: { slug: true, status: true },
      });
    });

    // The public page is cached per slug; a stale cache would keep serving a
    // closed invitation as open, or a published one as missing.
    await this.cache.invalidateInvitation(invitation.slug);
    return updated;
  }

  private assertCanMove(from: InvitationStatus, to: InvitationStatus): void {
    if (!canTransition(from, to)) {
      throw new BadRequestException(
        from === to
          ? `This invitation is already ${from.toLowerCase()}`
          : `An invitation cannot go from ${from.toLowerCase()} to ${to.toLowerCase()}`,
      );
    }
  }

  private async load(slug: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        status: true,
        eventId: true,
        blocks: { select: { type: true, enabled: true } },
        event: {
          select: { status: true, startsAt: true, venues: { select: { address: true } } },
        },
      },
    });
    if (!invitation) throw new NotFoundException(`No invitation at "${slug}"`);
    return invitation;
  }
}

/** An archived event's invitation stays closed until the event is brought back. */
function assertNotArchived(eventStatus: EventStatus): void {
  if (eventStatus === EventStatus.ARCHIVED) {
    throw new BadRequestException('This event is archived; bring it back with POST /events/:id/unarchive first');
  }
}
