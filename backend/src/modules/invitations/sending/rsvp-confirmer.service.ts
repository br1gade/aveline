import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel, RsvpStatus } from '@prisma/client';
import { deliverableChannels } from '../../communications/channels/transport-registry';
import { CommunicationsService } from '../../communications/communications.service';
import { GuestChannelsService } from '../../communications/guest-channels.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { channelsWithCopy, loadSendableHouseholds } from './audience';
import { confirmationDedupeKey, confirmationTemplateFor, statusConfirmedBy } from './rsvp-confirmation';
import { displayName, planInvitationSend } from './send-plan';

/**
 * Tells a guest their answer landed.
 *
 * Sent on every response, including a changed one — the host decided that
 * reassurance is worth a message, and a guest who switches from attending to
 * declined is exactly the guest who most needs to know the host saw it.
 *
 * It goes to the household's own recipient, chosen by the same rule as the
 * invitation, which is what puts it on the channel they were invited on: a
 * household reached on Telegram is confirmed on Telegram. The link inside is
 * the recipient's own, so tapping it lets them change their answer.
 */
@Injectable()
export class RsvpConfirmerService {
  private readonly logger = new Logger(RsvpConfirmerService.name);
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
   * Queues the confirmation.
   *
   * Never throws. The guest's answer is already saved, and failing the RSVP
   * because a confirmation could not be queued would tell them their reply
   * was lost when it was not — the opposite of what the message is for.
   */
  async confirm(guestId: string, status: RsvpStatus): Promise<void> {
    const templateKey = confirmationTemplateFor(status);
    if (!templateKey) return;

    try {
      await this.queue(guestId, status, templateKey);
    } catch (error) {
      this.logger.error(`could not confirm the RSVP of guest ${guestId}: ${describeError(error)}`);
    }
  }

  private async queue(guestId: string, status: RsvpStatus, templateKey: string): Promise<void> {
    const guest = await this.prisma.guest.findUniqueOrThrow({
      where: { id: guestId },
      select: {
        householdId: true,
        event: {
          select: {
            id: true,
            organizationId: true,
            title: true,
            hostsLabel: true,
            defaultLocale: true,
            invitation: { select: { slug: true } },
          },
        },
      },
    });

    const { event } = guest;
    if (!event.invitation) return;

    const [households, available] = await Promise.all([
      loadSendableHouseholds(this.prisma, this.guestChannels, { id: guest.householdId }),
      channelsWithCopy(this.prisma, event.organizationId, templateKey, this.configuredChannels),
    ]);

    const recipient = planInvitationSend(households, available).recipients[0];
    // Nobody in the household can be reached: they answered from a link
    // someone forwarded, and there is no address on file. Nothing to send.
    if (!recipient) return;

    const now = new Date();
    const dedupeKey = confirmationDedupeKey(guest.householdId, status, now, await this.confirmedThisMinute(guest.householdId, now));
    if (dedupeKey === null) return;

    await this.communications.enqueue({
      organizationId: event.organizationId,
      eventId: event.id,
      guestId: recipient.guest.id,
      channel: recipient.via.channel,
      templateKey,
      toAddress: recipient.via.address,
      locale: recipient.guest.locale ?? event.defaultLocale,
      variables: {
        guestName: displayName(recipient.guest),
        hosts: event.hostsLabel,
        eventTitle: event.title,
        link: `${this.appUrl}/invitations/${event.invitation.slug}/g/${recipient.guest.token}`,
      },
      dedupeKey,
    });
  }

  /** This household's confirmations queued in the current minute, newest first. */
  private async confirmedThisMinute(householdId: string, now: Date): Promise<RsvpStatus[]> {
    const minuteStart = new Date(now);
    minuteStart.setUTCSeconds(0, 0);
    const recent = await this.prisma.message.findMany({
      where: {
        dedupeKey: { startsWith: `rsvp-confirm:${householdId}:` },
        createdAt: { gte: minuteStart },
      },
      orderBy: { createdAt: 'desc' },
      select: { templateKey: true },
    });
    return recent.flatMap((message) => {
      const status = message.templateKey ? statusConfirmedBy(message.templateKey) : null;
      return status ? [status] : [];
    });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
