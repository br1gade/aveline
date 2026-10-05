import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvitationStatus,
  MessageChannel,
  MessageStatus,
  Prisma,
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
import { SendableHousehold, displayName, planInvitationSend } from './send-plan';

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
   * Channels we can send a reminder on and have copy for.
   *
   * A reminder is the message most likely to go over Telegram — the guest
   * opted in after receiving the invitation by email, which is exactly the
   * sequence the opt-in deep link creates.
   */
  private async usableChannels(
    organizationId: string,
    templateKey: string,
  ): Promise<MessageChannel[]> {
    const templates = await this.prisma.messageTemplate.findMany({
      where: {
        key: templateKey,
        isActive: true,
        OR: [{ organizationId }, { organizationId: null }],
      },
      select: { channel: true },
    });

    const withCopy = new Set(templates.map((template) => template.channel));
    return this.configuredChannels.filter((channel) => withCopy.has(channel));
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
    const available = await this.usableChannels(invitation.organizationId, TEMPLATE_KEY);

    return this.remind({
      invitation,
      households: pending,
      available,
      templateKey: TEMPLATE_KEY,
      dedupeKeyFor: (guestId) => manualDedupeKey(invitation.id, guestId, now),
    });
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

      const available = await this.usableChannels(
        invitation.event.organizationId,
        TEMPLATE_KEY,
      );
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
        dedupeKeyFor: (guestId) => milestoneDedupeKey(invitation.id, guestId, milestone),
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
      dedupeKeyFor: (guestId: string) => string;
    },
  ) {
    const { invitation, households, available, templateKey, dedupeKeyFor } = send;

    const plan = planInvitationSend(households, available);
    const queued: { householdName: string; toAddress: string; channel: MessageChannel }[] = [];
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
        channel: recipient.via.channel,
        templateKey,
        toAddress: recipient.via.address,
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

    const households = await this.attendedHouseholds(invitation.eventId);
    if (households.length === 0) {
      return { queued: 0, alreadyThanked: 0, recipients: [], notInvited: [] };
    }

    const available = await this.usableChannels(invitation.organizationId, THANK_YOU_TEMPLATE_KEY);
    const result = await this.remind({
      invitation,
      households,
      available,
      templateKey: THANK_YOU_TEMPLATE_KEY,
      dedupeKeyFor: (guestId) => `thankyou:${invitation.id}:${guestId}`,
    });

    return {
      queued: result.queued,
      // Once, ever — not once a day. A second thank-you is not a follow-up.
      alreadyThanked: result.alreadyRemindedToday,
      recipients: result.recipients,
      notInvited: result.notInvited,
    };
  }

  /**
   * Households where someone actually arrived.
   *
   * Arrival, not an RSVP: a guest who accepted and did not come should not be
   * thanked for coming.
   */
  private async attendedHouseholds(eventId: string): Promise<SendableHousehold[]> {
    return this.loadHouseholds({ eventId, guests: { some: { checkIn: { isNot: null } } } });
  }

  /**
   * Households with someone still undecided, who have already been invited.
   *
   * A guest who declined is not chased — that is the behaviour that turns a
   * reminder into a nuisance. Only PENDING counts; ATTENDING and DECLINED have
   * both answered.
   */
  private async pendingHouseholds(eventId: string): Promise<SendableHousehold[]> {
    return this.loadHouseholds({
      eventId,
      guests: {
        some: {
          // A guest with no RSVP row has not answered either. Treating
          // "pending" as the only unanswered state would silently exclude
          // anyone created by a path that has not written one yet, and never
          // chasing someone is a failure nobody notices.
          OR: [{ rsvp: null }, { rsvp: { status: RsvpStatus.PENDING } }],
          // Invited means an invitation message exists for them.
          messages: { some: { templateKey: 'invitation.send' } },
        },
      },
    });
  }

  /** One shape of household query, so every sender reads the same fields. */
  private async loadHouseholds(where: Prisma.HouseholdWhereInput): Promise<SendableHousehold[]> {
    const households = await this.prisma.household.findMany({
      where,
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
            phone: true,
            isPrimary: true,
            locale: true,
            token: true,
            anonymizedAt: true,
            channels: { select: { channel: true, address: true, optedInAt: true } },
          },
        },
      },
    });

    return households.map((household) => ({
      ...household,
      guests: household.guests.map((guest) => ({
        ...guest,
        addresses: this.guestChannels.addressesFor(guest),
      })),
    }));
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
