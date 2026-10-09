import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvitationStatus,
  MessageChannel,
  MessageStatus,
  RsvpStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { deliverableChannels } from '../../communications/channels/transport-registry';
import { CommunicationsService } from '../../communications/communications.service';
import { GuestChannelsService } from '../../communications/guest-channels.service';
import {
  REMINDER_MILESTONES,
  dueMilestone,
  manualDedupeKey,
  milestoneDedupeKey,
} from './reminder-schedule';
import { INVITATION_REACHED, channelsWithCopy, loadSendableHouseholds } from './audience';
import { SendableHousehold, displayName, planInvitationSend } from './send-plan';

/** Whether a thank-you went to guests who arrived or guests who accepted. */
type ThankYouBasis = 'ARRIVED' | 'ACCEPTED';

/** One row from the sweep's own query. */
interface DueInvitation {
  id: string;
  slug: string;
  eventId: string;
  event: {
    organizationId: string;
    title: string;
    hostsLabel: string;
    startsAt: Date;
    defaultLocale: string;
  };
}

/** What both the reminder and the thank-you need to know about an invitation. */
interface Remindable {
  id: string;
  slug: string;
  eventId: string;
  organizationId: string;
  title: string;
  hosts: string;
  defaultLocale: string;
}

const TEMPLATE_KEY = 'rsvp.reminder';
const THANK_YOU_TEMPLATE_KEY = 'thankyou.send';
const DETAILS_CHANGED_TEMPLATE_KEY = 'event.details-changed';

/** How far ahead the sweep looks. Beyond the widest milestone there is nothing
 *  to do, and scanning every future event every hour is wasted work. */
const HORIZON_DAYS = Math.max(...REMINDER_MILESTONES) + 1;

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  private readonly appUrl: string;

  private readonly configuredChannels: MessageChannel[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly communications: CommunicationsService,
    private readonly guestChannels: GuestChannelsService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:5173';
    this.configuredChannels = deliverableChannels(config);
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
    const available = await channelsWithCopy(this.prisma, invitation.organizationId, TEMPLATE_KEY, this.configuredChannels);

    return this.remind({
      invitation,
      households: pending,
      available,
      templateKey: TEMPLATE_KEY,
      dedupeKeyFor: (householdId) => manualDedupeKey(invitation.id, householdId, now),
    });
  }

  /**
   * Tells every household holding the invitation that its details changed.
   *
   * Offered to the host after they move the date or a venue (decided 8
   * October 2026), never sent on its own: a host fixing a typo in a venue's
   * name should not message four hundred people. Only households the
   * invitation reached — someone who never received it has nothing to update.
   * The message carries their own link, which always shows the current
   * details, and the host's note if they wrote one.
   *
   * Pressing it twice in one minute sends once; a later change can be
   * announced again.
   */
  async notifyDetailsChanged(slug: string, note?: string) {
    const invitation = await this.loadInvitation(slug);
    if (invitation.status === InvitationStatus.DRAFT) {
      throw new BadRequestException('This invitation has not been published, so nobody has it yet');
    }

    const households = await loadSendableHouseholds(this.prisma, this.guestChannels, {
      eventId: invitation.eventId,
      guests: { some: { messages: INVITATION_REACHED } },
    });
    const available = await channelsWithCopy(
      this.prisma,
      invitation.organizationId,
      DETAILS_CHANGED_TEMPLATE_KEY,
      this.configuredChannels,
    );
    const minute = new Date().toISOString().slice(0, 16);

    const result = await this.remind({
      invitation,
      households,
      available,
      templateKey: DETAILS_CHANGED_TEMPLATE_KEY,
      dedupeKeyFor: (householdId) => `details-changed:${invitation.id}:${householdId}:${minute}`,
      variables: { note: note?.trim() ?? '' },
    });
    return {
      queued: result.queued,
      alreadyNotified: result.alreadyRemindedToday,
      recipients: result.recipients,
      unreachable: result.notInvited,
    };
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
      const sent = await this.remindOneEvent(invitation, now);
      if (sent > 0) {
        events += 1;
        queued += sent;
      }
    }

    return { events, queued };
  }

  /** One event's due milestone, or nothing if none is in force. */
  private async remindOneEvent(invitation: DueInvitation, now: Date): Promise<number> {
    const milestone = dueMilestone(invitation.event.startsAt, now);
    if (milestone === null) return 0;

    const pending = await this.pendingHouseholds(invitation.eventId);
    if (pending.length === 0) return 0;

      const available = await channelsWithCopy(this.prisma, invitation.event.organizationId, TEMPLATE_KEY, this.configuredChannels);
      const result = await this.remind({
        invitation: {
          id: invitation.id,
          slug: invitation.slug,
          eventId: invitation.eventId,
          organizationId: invitation.event.organizationId,
          title: invitation.event.title,
          hosts: invitation.event.hostsLabel,
          defaultLocale: invitation.event.defaultLocale,
        },
        households: pending,
        available,
        templateKey: TEMPLATE_KEY,
        dedupeKeyFor: (householdId) => milestoneDedupeKey(invitation.id, householdId, milestone),
      });

    if (result.queued > 0) {
      this.logger.log(
        `reminders: ${result.queued} queued for "${invitation.event.title}" at T-${milestone} days`,
      );
    }
    return result.queued;
  }

  private async remind(
    send: {
      invitation: Remindable;
      households: SendableHousehold[];
      available: MessageChannel[];
      templateKey: string;
      /**
       * Keyed by household, which is the unit written to: its recipient can
       * change between runs, and a key per guest then wrote to it twice.
       */
      dedupeKeyFor: (householdId: string) => string;
      /** Extra copy variables, beyond the ones every household message has. */
      variables?: Record<string, string>;
    },
  ) {
    const { invitation, households, available, templateKey, dedupeKeyFor } = send;

    const plan = planInvitationSend(households, available);
    const queued: { householdName: string; toAddress: string; channel: MessageChannel }[] = [];
    let alreadyRemindedToday = 0;

    // One query for every key, rather than one per household.
    const alreadySent = await this.existingKeys(plan.recipients.map((recipient) => dedupeKeyFor(recipient.householdId)));

    for (const recipient of plan.recipients) {
      const dedupeKey = dedupeKeyFor(recipient.householdId);
      if (alreadySent.has(dedupeKey)) {
        alreadyRemindedToday += 1;
        continue;
      }

      const message = await this.communications.enqueue({
        organizationId: invitation.organizationId,
        eventId: invitation.eventId,
        guestId: recipient.guest.id,
        channel: recipient.via.channel,
        templateKey,
        toAddress: recipient.via.address,
        locale: recipient.guest.locale ?? invitation.defaultLocale,
        variables: {
          guestName: displayName(recipient.guest),
          hosts: invitation.hosts,
          eventTitle: invitation.title,
          link: `${this.appUrl}/invitations/${invitation.slug}/g/${recipient.guest.token}`,
          ...send.variables,
        },
        dedupeKey,
      });

      if (message.status !== MessageStatus.SUPPRESSED) {
        queued.push({
          householdName: recipient.householdName,
          toAddress: recipient.via.address,
          channel: recipient.via.channel,
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

  private async existingKeys(dedupeKeys: string[]): Promise<Set<string>> {
    const existing = await this.prisma.message.findMany({
      where: { dedupeKey: { in: dedupeKeys } },
      select: { dedupeKey: true },
    });
    return new Set(existing.map((message) => message.dedupeKey).filter((key): key is string => key !== null));
  }

  /**
   * Thanks the people who came.
   *
   * The same shape as a reminder — one message per household, through the same
   * outbox — but filtered to guests who actually arrived. Check-in is what
   * makes this possible and is why it is worth doing: thanking someone who
   * said yes and then did not come is worse than saying nothing.
   *
   * Refused before the event, because a thank-you that arrives first reads as
   * a mistake and cannot be unsent.
   */
  async thankAttendees(slug: string) {
    const invitation = await this.loadInvitation(slug);

    if (invitation.startsAt > new Date()) {
      throw new BadRequestException(
        'This event has not happened yet; a thank-you now would arrive before the event',
      );
    }

    const { households, basis } = await this.thankableHouseholds(invitation.eventId);
    if (households.length === 0) {
      return { queued: 0, alreadyThanked: 0, basis, recipients: [], notInvited: [] };
    }

    const available = await channelsWithCopy(this.prisma, invitation.organizationId, THANK_YOU_TEMPLATE_KEY, this.configuredChannels);
    const result = await this.remind({
      invitation,
      households,
      available,
      templateKey: THANK_YOU_TEMPLATE_KEY,
      dedupeKeyFor: (householdId) => `thankyou:${invitation.id}:${householdId}`,
    });

    return {
      queued: result.queued,
      // Once, ever — not once a day. A second thank-you is not a follow-up.
      alreadyThanked: result.alreadyRemindedToday,
      // Said in the response so the host knows who was thanked and why: an
      // event with check-ins thanks arrivals, one without thanks acceptances.
      basis,
      recipients: result.recipients,
      notInvited: result.notInvited,
    };
  }

  /**
   * Who to thank: the people who arrived, or — when nobody ran the door — the
   * people who said they would come.
   *
   * Arrival is preferred because it is true: a guest who accepted and did not
   * come should not be thanked for coming. But many hosts never use check-in,
   * and for them "arrivals only" meant the thank-you silently went to nobody.
   * So the fallback applies only when the event has **no check-ins at all** —
   * a door that recorded even one arrival is taken as a door that recorded
   * them all, and a partial list is not padded out with acceptances.
   */
  private async thankableHouseholds(
    eventId: string,
  ): Promise<{ households: SendableHousehold[]; basis: ThankYouBasis }> {
    const checkIns = await this.prisma.checkIn.count({ where: { guest: { eventId } } });

    if (checkIns > 0) {
      return {
        basis: 'ARRIVED',
        households: await loadSendableHouseholds(this.prisma, this.guestChannels, {
          eventId,
          guests: { some: { checkIn: { isNot: null } } },
        }),
      };
    }

    return {
      basis: 'ACCEPTED',
      households: await loadSendableHouseholds(this.prisma, this.guestChannels, {
        eventId,
        guests: { some: { rsvp: { status: RsvpStatus.ATTENDING } } },
      }),
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
    return loadSendableHouseholds(this.prisma, this.guestChannels, {
      eventId,
      guests: {
        some: {
          // A guest with no RSVP row has not answered either. Treating
          // "pending" as the only unanswered state would silently exclude
          // anyone created by a path that has not written one yet, and never
          // chasing someone is a failure nobody notices.
          OR: [{ rsvp: null }, { rsvp: { status: RsvpStatus.PENDING } }],
          // Invited means the invitation reached them, not that one was tried.
          messages: INVITATION_REACHED,
        },
      },
    });
  }

  private async loadRemindable(slug: string) {
    const invitation = await this.loadInvitation(slug);

    if (invitation.status !== InvitationStatus.PUBLISHED) {
      throw new BadRequestException('This invitation has not been published, so nobody has it yet');
    }
    if (invitation.startsAt <= new Date()) {
      throw new BadRequestException('This event has already started; a reminder would read oddly');
    }
    return invitation;
  }

  private async loadInvitation(slug: string) {
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

    return {
      id: invitation.id,
      slug: invitation.slug,
      status: invitation.status,
      eventId: invitation.eventId,
      organizationId: invitation.event.organizationId,
      title: invitation.event.title,
      hosts: invitation.event.hostsLabel,
      startsAt: invitation.event.startsAt,
      defaultLocale: invitation.event.defaultLocale,
    };
  }
}
