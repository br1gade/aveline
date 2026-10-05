import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvitationStatus,
  MessageChannel,
  MessageStatus,
  RsvpStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommunicationsService } from '../../communications/communications.service';
import {
  REMINDER_MILESTONES,
  dueMilestone,
  manualDedupeKey,
  milestoneDedupeKey,
} from './reminder-schedule';
import { SendableHousehold, displayName, planInvitationSend } from './send-plan';

const TEMPLATE_KEY = 'rsvp.reminder';

/** How far ahead the sweep looks. Beyond the widest milestone there is nothing
 *  to do, and scanning every future event every hour is wasted work. */
const HORIZON_DAYS = Math.max(...REMINDER_MILESTONES) + 1;

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly communications: CommunicationsService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:5173';
  }

  /**
   * Reminds the households that have not answered yet.
   *
   * Only the ones who were actually invited: reminding someone about an
   * invitation they never received reads as an accusation, and the thing to do
   * for them is send the invitation.
   *
   * A host may follow up again tomorrow, but not twice today — the dedupe key
   * is bucketed by day, which is both double-click-safe and a defensible rule
   * to state to a guest.
   */
  async remindNow(slug: string) {
    const invitation = await this.loadRemindable(slug);
    const pending = await this.pendingHouseholds(invitation.eventId);

    if (pending.length === 0) {
      return { queued: 0, alreadyRemindedToday: 0, recipients: [], notInvited: [] };
    }

    const now = new Date();
    return this.remind(invitation, pending, (guestId) =>
      manualDedupeKey(invitation.id, guestId, now),
    );
  }

  /**
   * The scheduled sweep.
   *
   * Runs often and does nothing most of the time, which is the point: a
   * milestone's reminder is enqueued the first time the sweep sees that
   * milestone in force, and the dedupe key makes every later run a no-op.
   * Nothing here needs to remember what it has already done.
   */
  async sendDueReminders(now = new Date()): Promise<{ events: number; queued: number }> {
    const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

    const invitations = await this.prisma.invitation.findMany({
      where: {
        status: InvitationStatus.PUBLISHED,
        event: {
          remindersEnabled: true,
          startsAt: { gt: now, lte: horizon },
        },
      },
      select: {
        id: true,
        slug: true,
        eventId: true,
        event: {
          select: {
            organizationId: true,
            title: true,
            hostsLabel: true,
            startsAt: true,
            defaultLocale: true,
          },
        },
      },
    });

    let queued = 0;
    let events = 0;

    for (const invitation of invitations) {
      const milestone = dueMilestone(invitation.event.startsAt, now);
      if (milestone === null) continue;

      const pending = await this.pendingHouseholds(invitation.eventId);
      if (pending.length === 0) continue;

      const result = await this.remind(
        {
          id: invitation.id,
          slug: invitation.slug,
          eventId: invitation.eventId,
          organizationId: invitation.event.organizationId,
          title: invitation.event.title,
          hosts: invitation.event.hostsLabel,
          defaultLocale: invitation.event.defaultLocale,
        },
        pending,
        (guestId) => milestoneDedupeKey(invitation.id, guestId, milestone),
      );

      if (result.queued > 0) {
        events += 1;
        queued += result.queued;
        this.logger.log(
          `reminders: ${result.queued} queued for "${invitation.event.title}" at T-${milestone} days`,
        );
      }
    }

    return { events, queued };
  }

  private async remind(
    invitation: {
      id: string;
      slug: string;
      eventId: string;
      organizationId: string;
      title: string;
      hosts: string;
      defaultLocale: string;
    },
    households: SendableHousehold[],
    dedupeKeyFor: (guestId: string) => string,
  ) {
    const plan = planInvitationSend(households);
    const queued: { householdName: string; toAddress: string }[] = [];
    let alreadyRemindedToday = 0;

    for (const recipient of plan.recipients) {
      const dedupeKey = dedupeKeyFor(recipient.guest.id);
      const existing = await this.prisma.message.findUnique({ where: { dedupeKey } });
      if (existing) {
        alreadyRemindedToday += 1;
        continue;
      }

      const message = await this.communications.enqueue({
        organizationId: invitation.organizationId,
        eventId: invitation.eventId,
        guestId: recipient.guest.id,
        channel: MessageChannel.EMAIL,
        templateKey: TEMPLATE_KEY,
        toAddress: recipient.guest.email ?? '',
        locale: recipient.guest.locale ?? invitation.defaultLocale,
        variables: {
          guestName: displayName(recipient.guest),
          hosts: invitation.hosts,
          eventTitle: invitation.title,
          link: `${this.appUrl}/invitations/${invitation.slug}/g/${recipient.guest.token}`,
        },
        dedupeKey,
      });

      if (message.status !== MessageStatus.SUPPRESSED) {
        queued.push({
          householdName: recipient.householdName,
          toAddress: recipient.guest.email ?? '',
        });
      }
    }

    return {
      queued: queued.length,
      alreadyRemindedToday,
      recipients: queued,
      // Separate from "unreachable": the fix is to send the invitation, not to
      // correct an address.
      notInvited: plan.skipped,
    };
  }

  /**
   * Households with someone still undecided, who have already been invited.
   *
   * A guest who declined is not chased — that is the behaviour that turns a
   * reminder into a nuisance. Only PENDING counts; ATTENDING and DECLINED have
   * both answered.
   */
  private async pendingHouseholds(eventId: string): Promise<SendableHousehold[]> {
    const households = await this.prisma.household.findMany({
      where: {
        eventId,
        guests: {
          some: {
            // A guest with no RSVP row has not answered either. Treating
            // "pending" as the only unanswered state would silently exclude
            // anyone created by a path that has not written one yet, and
            // never chasing someone is a failure nobody notices.
            OR: [{ rsvp: null }, { rsvp: { status: RsvpStatus.PENDING } }],
            // Invited means an invitation message exists for them.
            messages: { some: { templateKey: 'invitation.send' } },
          },
        },
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        guests: {
          orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isPrimary: true,
            locale: true,
            token: true,
            anonymizedAt: true,
          },
        },
      },
    });

    return households;
  }

  private async loadRemindable(slug: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        status: true,
        eventId: true,
        event: {
          select: {
            organizationId: true,
            title: true,
            hostsLabel: true,
            startsAt: true,
            defaultLocale: true,
          },
        },
      },
    });
    if (!invitation) throw new NotFoundException(`No invitation at "${slug}"`);

    if (invitation.status !== InvitationStatus.PUBLISHED) {
      throw new BadRequestException('This invitation has not been published, so nobody has it yet');
    }
    if (invitation.event.startsAt <= new Date()) {
      throw new BadRequestException('This event has already started; a reminder would read oddly');
    }

    return {
      id: invitation.id,
      slug: invitation.slug,
      eventId: invitation.eventId,
      organizationId: invitation.event.organizationId,
      title: invitation.event.title,
      hosts: invitation.event.hostsLabel,
      defaultLocale: invitation.event.defaultLocale,
    };
  }
}
