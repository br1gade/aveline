import { MessageChannel } from '@prisma/client';
import { isSafeAddress } from '../../../common/address';

/**
 * Which channel to reach a guest on.
 *
 * The rule follows from what each channel can actually do, not from what looks
 * modern:
 *
 * - **Telegram** is preferred when the guest has opted in, because they chose
 *   it, it is free, and a message there is read sooner than an email. It can
 *   never be the first contact: a bot cannot message someone who has not
 *   started a conversation with it.
 * - **WhatsApp** can reach someone cold, so it is the fallback when there is a
 *   phone number and no Telegram. Every message costs, which is why it does
 *   not outrank a channel the guest opted into.
 * - **Email** always works from nothing, which is what makes it the default for
 *   an invitation nobody has yet.
 * - **SMS** is last: every text costs, and it is for the guest with a phone
 *   and nothing else — often the older half of an Armenian guest list. A
 *   number reachable on WhatsApp is reached there first.
 *
 * Pure, because "how do we write to this person" is a product decision that
 * must be inspectable in one place rather than spread across two senders.
 */
export interface GuestAddress {
  channel: MessageChannel;
  address: string;
  /** Null when the host supplied the address rather than the guest opting in. */
  optedInAt: Date | null;
}

export interface ChannelChoice {
  channel: MessageChannel;
  address: string;
}

/**
 * Preference order, widest-reaching last.
 *
 * A table rather than branching: adding Viber is adding a row here and a
 * transport, and the order is the whole policy in one place.
 */
export const CHANNEL_PREFERENCE: readonly MessageChannel[] = [
  MessageChannel.TELEGRAM,
  MessageChannel.WHATSAPP,
  MessageChannel.EMAIL,
  MessageChannel.SMS,
];

/**
 * Channels a guest must have opted into before we may write to them.
 *
 * Telegram is a platform rule — the bot simply cannot send otherwise. Keeping
 * it as data rather than a special case means an address recorded by mistake
 * cannot be used.
 */
const REQUIRES_OPT_IN: readonly MessageChannel[] = [MessageChannel.TELEGRAM];

/**
 * The best channel available for one guest, or null if none is.
 *
 * `available` is which transports the server actually has configured: offering
 * WhatsApp when no credentials exist would queue messages that can only fail.
 */
export function chooseChannel(
  addresses: readonly GuestAddress[],
  available: readonly MessageChannel[],
): ChannelChoice | null {
  for (const channel of CHANNEL_PREFERENCE) {
    if (!available.includes(channel)) continue;

    const usable = addresses.find(
      (candidate) => candidate.channel === channel && isUsable(candidate),
    );
    if (usable) return { channel, address: usable.address };
  }

  return null;
}

function isUsable(address: GuestAddress): boolean {
  // Checked here as well as at every boundary that records an address. This is
  // the last point before a transport receives it, and an address carrying a
  // CRLF is an injected protocol command on every channel in use — so the
  // check belongs where it cannot be bypassed by a new way of storing one.
  if (!isSafeAddress(address.address)) return false;
  if (REQUIRES_OPT_IN.includes(address.channel) && address.optedInAt === null) return false;
  return true;
}

/**
 * Why a guest could not be reached, written for a host to read.
 *
 * The distinction that matters to them: an address we have but cannot use yet
 * is a different problem from no address at all.
 */
export function unreachableReason(
  addresses: readonly GuestAddress[],
  available: readonly MessageChannel[],
): string {
  if (addresses.length === 0) return 'No email address for anyone in this household';

  const isAwaitingOptIn = addresses.some(
    (address) => REQUIRES_OPT_IN.includes(address.channel) && address.optedInAt === null,
  );
  if (isAwaitingOptIn) {
    return 'This guest has not opened the Telegram link yet, and has no other address';
  }

  const unconfigured = addresses.filter((address) => !available.includes(address.channel));
  if (unconfigured.length === addresses.length) {
    return `We hold only a ${unconfigured[0].channel.toLowerCase()} address, and that channel is not configured`;
  }

  return 'No usable address for anyone in this household';
}
