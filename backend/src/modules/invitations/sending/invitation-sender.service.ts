import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InvitationStatus, MessageChannel, MessageStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { deliverableChannels } from '../../communications/channels/transport-registry';
import { CommunicationsService } from '../../communications/communications.service';
import { GuestChannelsService } from '../../communications/guest-channels.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { channelsWithCopy, loadSendableHouseholds } from './audience';
import { PreviousAttempt, hasReachedGuest, isSupersededFailure } from './previous-attempts';
import {
  Recipient,
  SendableHousehold,
  displayName,
  planInvitationSend,
} from './send-plan';

/** The template whose copy an invitation email uses. */
const TEMPLATE_KEY = 'invitation.send';

@Injectable()
export class InvitationSenderService {
  private readonly logger = new Logger(InvitationSenderService.name);
  private readonly appUrl: string;

  private readonly configuredChannels: MessageChannel[];
  private readonly botUsername: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly communications: CommunicationsService,
    private readonly guestChannels: GuestChannelsService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:5173';
    this.configuredChannels = deliverableChannels(config);
    this.botUsername = config.get<string>('TELEGRAM_BOT_USERNAME') ?? '';
  }

  /**
   * Sends the invitation, one email per household.
   *
   * This is the product's core loop and the step the market still does by
   * hand: pasting a link into four hundred chats individually. It is safe to
   * press twice: a guest who was reached, or whose invitation is on its way,
   * is not sent another (see `hasReachedGuest`). A guest whose invitation
   * bounced is tried again on the next press — reaching them at a corrected
   * address, or reported as suppressed while the old one is still on file.
   *
   * Queued rather than sent inline. Four hundred SMTP conversations inside one
   * request would hold it open for minutes and fail halfway with no record of
   * where it stopped; the outbox already knows how to claim, retry and report.
   */
  async send(slug: string, options: { guestIds?: string[] } = {}) {
    const invitation = await this.loadSendable(slug);
    const households = await this.householdsFor(invitation.eventId, options.guestIds);

    if (households.length === 0) {
      throw new BadRequestException(
        options.guestIds
          ? 'None of those guests are on this event'
          : 'This event has no guests to invite yet',
      );
    }

    const available = await channelsWithCopy(this.prisma, invitation.organizationId, TEMPLATE_KEY, this.configuredChannels);
    const plan = planInvitationSend(households, available);
    const previous = await this.previousAttempts(invitation.eventId, plan.recipients.map((r) => r.guest.id));
    const outcome = new SendOutcome();

    for (const recipient of plan.recipients) {
      const attempts = previous.get(recipient.guest.id) ?? [];
      const result = hasReachedGuest(attempts)
        ? 'ALREADY_SENT'
        : await this.enqueueFor(invitation, recipient, attempts.length + 1);
      outcome.record(result, recipient);
    }

    this.logger.log(
      `invitation ${slug}: queued ${outcome.queued.length}, already sent ${outcome.alreadySent}, ` +
        `suppressed ${outcome.suppressed.length}, unreachable ${plan.skipped.length}`,
    );

    return {
      queued: outcome.queued.length,
      alreadySent: outcome.alreadySent,
      recipients: outcome.queued,
      // Three separate lists because they need three different actions from a
      // host: nothing, a conversation with the guest, or an address to fix.
      suppressed: outcome.suppressed,
      unreachable: plan.skipped,
    };
  }

  /** Every earlier invitation attempt for these guests, in one query. */
  private async previousAttempts(
    eventId: string,
    guestIds: string[],
  ): Promise<Map<string, PreviousAttempt[]>> {
    const messages = await this.prisma.message.findMany({
      where: { eventId, templateKey: TEMPLATE_KEY, guestId: { in: guestIds } },
      select: { guestId: true, toAddress: true, status: true },
    });

    const byGuest = new Map<string, PreviousAttempt[]>();
    for (const { guestId, ...attempt } of messages) {
      if (!guestId) continue;
      byGuest.set(guestId, [...(byGuest.get(guestId) ?? []), attempt]);
    }
    return byGuest;
  }

  /**
   * What happened to every invitation on this event.
   *
   * Grouped by household, because that is the unit a host thinks in — "have
   * the Petrosyans been invited?" is the question, not "what is the status of
   * message 4f2a".
   */
  async deliveryStatus(slug: string) {
    const invitation = await this.loadInvitation(slug);

    const [households, messages] = await Promise.all([
      this.householdsFor(invitation.eventId),
      this.prisma.message.findMany({
        where: { eventId: invitation.eventId, templateKey: TEMPLATE_KEY },
        orderBy: { createdAt: 'desc' },
        select: {
          guestId: true,
          toAddress: true,
          status: true,
          attempts: true,
          failureReason: true,
          sentAt: true,
        },
      }),
    ]);

    // Newest first, so the first message seen for a guest is their latest.
    const attemptsByGuest = new Map<string, (typeof messages)[number][]>();
    for (const message of messages) {
      if (!message.guestId) continue;
      attemptsByGuest.set(message.guestId, [...(attemptsByGuest.get(message.guestId) ?? []), message]);
    }

    const available = await channelsWithCopy(this.prisma, invitation.organizationId, TEMPLATE_KEY, this.configuredChannels);
    const plan = planInvitationSend(households, available);
    const rows = plan.recipients.map((recipient) =>
      deliveryRow(recipient, attemptsByGuest.get(recipient.guest.id) ?? []),
    );

    return {
      invited: rows.filter((row) => row.status !== 'NOT_SENT').length,
      notSent: rows.filter((row) => row.status === 'NOT_SENT').length,
      unreachable: plan.skipped,
      households: rows,
    };
  }

  private async enqueueFor(
    invitation: { id: string; slug: string; eventId: string; organizationId: string; hosts: string; title: string; defaultLocale: string },
    recipient: Recipient,
    attemptNumber: number,
  ): Promise<'QUEUED' | 'SUPPRESSED'> {
    const { guest } = recipient;
    // Whether to send at all was decided by `hasReachedGuest`. The key, per
    // attempt, is what keeps two simultaneous presses of "send" — which both
    // count the same earlier attempts — from both queueing.
    const dedupeKey = `invitation:${invitation.id}:${guest.id}:${attemptNumber}`;

    const message = await this.communications.enqueue({
      organizationId: invitation.organizationId,
      eventId: invitation.eventId,
      guestId: guest.id,
      channel: recipient.via.channel,
      templateKey: TEMPLATE_KEY,
      toAddress: recipient.via.address,
      locale: guest.locale ?? invitation.defaultLocale,
      variables: {
        guestName: displayName(guest),
        hosts: invitation.hosts,
        eventTitle: invitation.title,
        link: this.linkFor(invitation.slug, guest.token),
        telegramLink: this.telegramLinkFor(guest.token),
      },
      dedupeKey,
    });

    return message.status === MessageStatus.SUPPRESSED ? 'SUPPRESSED' : 'QUEUED';
  }

  /** Every household on the event, or only those containing the named guests. */
  private householdsFor(eventId: string, guestIds?: string[]): Promise<SendableHousehold[]> {
    return loadSendableHouseholds(this.prisma, this.guestChannels, {
      eventId,
      ...(guestIds ? { guests: { some: { id: { in: guestIds } } } } : {}),
    });
  }

  /** The guest's own capability URL — the thing the whole email exists to carry. */
  private linkFor(slug: string, token: string): string {
    return `${this.appUrl}/invitations/${slug}/g/${token}`;
  }

  /**
   * The Telegram deep link, when a bot is configured.
   *
   * Carried as a template variable so a host can offer it in the invitation
   * copy: tapping it is the only way a guest can ever receive anything on
   * Telegram, since a bot cannot open a conversation itself. The payload is
   * the guest's existing capability token — the same one already in their
   * invitation URL — so this adds no new secret.
   */
  private telegramLinkFor(token: string): string {
    return this.botUsername ? `https://t.me/${this.botUsername}?start=${token}` : '';
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
      defaultLocale: invitation.event.defaultLocale,
    };
  }

  /**
   * Refuses to send a draft.
   *
   * The link in the email resolves to a public page that 404s until the
   * invitation is published, so sending first would mail four hundred people a
   * dead link — and those emails cannot be recalled.
   */
  private async loadSendable(slug: string) {
    const invitation = await this.loadInvitation(slug);

    if (invitation.status !== InvitationStatus.PUBLISHED) {
      throw new BadRequestException(
        `This invitation is ${invitation.status.toLowerCase()}; publish it before sending, ` +
          'or guests will receive a link to a page that is not there',
      );
    }
    return invitation;
  }

}

/** What one press of "send" did, grouped by what the host should do next. */
class SendOutcome {
  readonly queued: { householdName: string; toAddress: string; channel: MessageChannel }[] = [];
  readonly suppressed: { householdName: string; toAddress: string }[] = [];
  alreadySent = 0;

  record(result: 'ALREADY_SENT' | 'QUEUED' | 'SUPPRESSED', recipient: Recipient) {
    const who = { householdName: recipient.householdName, toAddress: recipient.via.address };

    if (result === 'ALREADY_SENT') this.alreadySent += 1;
    else if (result === 'SUPPRESSED') this.suppressed.push(who);
    else this.queued.push({ ...who, channel: recipient.via.channel });
  }
}

interface RecordedAttempt extends PreviousAttempt {
  attempts: number;
  failureReason: string | null;
  sentAt: Date | null;
}

/** One household's line in the delivery report, from its attempts newest first. */
function deliveryRow(recipient: Recipient, attempts: RecordedAttempt[]) {
  // A failure at an address the host has since corrected is history, not
  // status: what matters now is that the new address has not been sent to.
  const latest = isSupersededFailure(attempts[0], recipient.via.address) ? undefined : attempts[0];

  return {
    householdId: recipient.householdId,
    household: recipient.householdName,
    guest: displayName(recipient.guest),
    channel: recipient.via.channel,
    toAddress: recipient.via.address,
    status: latest?.status ?? 'NOT_SENT',
    attempts: latest?.attempts ?? 0,
    failureReason: latest?.failureReason ?? null,
    sentAt: latest?.sentAt ?? null,
  };
}
