import { Injectable, Logger } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
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
  async recordOptIn(guestId: string, channel: MessageChannel, address: string) {
    const now = new Date();

    const saved = await this.prisma.guestChannel.upsert({
      where: { guestId_channel: { guestId, channel } },
      create: { guestId, channel, address, optedInAt: now },
      update: { address, optedInAt: now },
    });

    this.logger.log(`guest ${guestId} opted into ${channel}`);
    return saved;
  }

  /**
   * Forgets a chat channel.
   *
   * Used when a guest blocks the bot: the suppression list stops us writing,
   * and removing the address stops us choosing the channel at all, so they
   * fall back to email rather than silently receiving nothing.
   */
  async forget(guestId: string, channel: MessageChannel) {
    await this.prisma.guestChannel.deleteMany({ where: { guestId, channel } });
    return { ok: true as const };
  }
}
