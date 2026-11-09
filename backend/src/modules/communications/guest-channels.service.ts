import { INVITATION_EMAIL_TEMPLATE, REDEEMABLE_EMAIL_STATUSES, telegramOptInBinding, telegramOptInDigest } from './telegram-opt-in';
import { lockGuestAccess, readGuestAccess } from '../guest-contributions/guest-access';
import { Injectable, Logger } from '@nestjs/common';
import { MessageChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GuestAddress } from '../invitations/sending/channel-preference';

@Injectable()
export class GuestChannelsService {
  private readonly logger = new Logger(GuestChannelsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every way one guest can be reached, including the email and phone that
   * live on the Guest row itself.
   *
   * Those two are folded in here rather than duplicated into `GuestChannel`,
   * because a host types them when adding a guest and copying them would mean
   * two places to keep in step. Phone is offered as a WhatsApp address — on
   * WhatsApp a number is reachable without any opt-in, which is the whole
   * reason that channel is worth having — and as an SMS address, for a guest
   * with neither WhatsApp nor email.
   */
  addressesFor(guest: {
    email: string | null;
    phone: string | null;
    channels?: { channel: MessageChannel; address: string; optedInAt: Date | null }[];
  }): GuestAddress[] {
    const addresses: GuestAddress[] = (guest.channels ?? []).map((channel) => ({
      channel: channel.channel,
      address: channel.address,
      optedInAt: channel.optedInAt,
    }));

    const has = (channel: MessageChannel) =>
      addresses.some((address) => address.channel === channel);

    if (guest.email && !has(MessageChannel.EMAIL)) {
      addresses.push({ channel: MessageChannel.EMAIL, address: guest.email, optedInAt: null });
    }
    if (guest.phone && !has(MessageChannel.WHATSAPP)) {
      addresses.push({ channel: MessageChannel.WHATSAPP, address: guest.phone, optedInAt: null });
    }
    if (guest.phone && !has(MessageChannel.SMS)) {
      addresses.push({ channel: MessageChannel.SMS, address: guest.phone, optedInAt: null });
    }

    return addresses;
  }

  /**
   * Records a guest opting into a chat channel themselves.
   *
   * `optedInAt` is set because the guest performed the act — on Telegram they
   * had to, since a bot cannot write to someone who has not started the
   * conversation. That timestamp is the evidence they agreed.
   *
   * An opt-in from a second device replaces the first rather than adding to
   * it, so a guest cannot end up receiving every message twice.
   */
  async recordOptIn(guestId: string, channel: MessageChannel, address: string, tx: Prisma.TransactionClient = this.prisma) {
    const now = new Date();

    const saved = await tx.guestChannel.upsert({
      where: { guestId_channel: { guestId, channel } },
      create: { guestId, channel, address, optedInAt: now },
      update: { address, optedInAt: now },
    });

    this.logger.log(`guest ${guestId} opted into ${channel}`);
    return saved;
  }

  async redeemTelegramOptIn(tx: Prisma.TransactionClient, input: { code: string; bot: string; chatId: string }) {
    const digest = telegramOptInDigest(input.code);
    if (!digest || !input.bot) return false;

    const pending = await readPendingTelegramOptIn(tx, digest, input.bot);
    if (!pending) return false;
    const { message, invitation, token } = pending;
    const guest = await lockGuestAccess(tx, invitation.slug, token);
    if (guest.eventId !== message.eventId || guest.event.invitation?.id !== invitation.id) return false;
    const now = new Date();
    const claimed = await tx.message.updateMany({
      where: { id: message.id, telegramOptInRedeemedAt: null, status: { in: REDEEMABLE_EMAIL_STATUSES }, telegramOptInExpiresAt: { gt: now } },
      data: { telegramOptInRedeemedAt: now },
    });
    if (claimed.count === 0) return false;
    await this.recordOptIn(guest.id, MessageChannel.TELEGRAM, input.chatId, tx);
    await readGuestAccess(tx, invitation.slug, token);
    return true;
  }
}

async function readPendingTelegramOptIn(tx: Prisma.TransactionClient, digest: string, bot: string) {
  const message = await tx.message.findUnique({
    where: { telegramOptInDigest: digest, telegramOptInRedeemedAt: null,
      channel: MessageChannel.EMAIL, templateKey: INVITATION_EMAIL_TEMPLATE,
      status: { in: REDEEMABLE_EMAIL_STATUSES }, telegramOptInExpiresAt: { gt: new Date() } },
    select: {
      id: true, eventId: true, telegramOptInBinding: true,
      guest: { select: { token: true, event: { select: { invitation: { select: { id: true, slug: true } } } } } },
    },
  });
  const invitation = message?.guest?.event.invitation;
  if (!message?.guest || !invitation || message.telegramOptInBinding !== telegramOptInBinding(bot, invitation.id, message.guest.token)) return null;

  return { message, invitation, token: message.guest.token };
}
