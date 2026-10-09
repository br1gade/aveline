import { MessageChannel } from '@prisma/client';
import { GuestAddress, chooseChannel, unreachableReason } from './channel-preference';

const EVERYTHING = [MessageChannel.TELEGRAM, MessageChannel.WHATSAPP, MessageChannel.EMAIL];

const telegram = (optedIn = true): GuestAddress => ({
  channel: MessageChannel.TELEGRAM,
  address: '123456789',
  optedInAt: optedIn ? new Date('2026-10-01') : null,
});

const whatsapp = (): GuestAddress => ({
  channel: MessageChannel.WHATSAPP,
  address: '+37410000000',
  optedInAt: null,
});

const email = (): GuestAddress => ({
  channel: MessageChannel.EMAIL,
  address: 'armen@test.local',
  optedInAt: null,
});

const sms = (): GuestAddress => ({
  channel: MessageChannel.SMS,
  address: '+37410000000',
  optedInAt: null,
});

describe('chooseChannel', () => {
  describe('preference order', () => {
    // A guest who opted into Telegram chose it, it is free, and it is read
    // sooner. Nothing should outrank that.
    it('prefers Telegram when the guest opted in', () => {
      expect(chooseChannel([email(), whatsapp(), telegram()], EVERYTHING)).toEqual({
        channel: MessageChannel.TELEGRAM,
        address: '123456789',
      });
    });

    // WhatsApp costs per message, so it never outranks an opted-in channel.
    it('falls back to WhatsApp when there is no Telegram', () => {
      expect(chooseChannel([email(), whatsapp()], EVERYTHING)?.channel).toBe(
        MessageChannel.WHATSAPP,
      );
    });

    it('falls back to email last', () => {
      expect(chooseChannel([email()], EVERYTHING)?.channel).toBe(MessageChannel.EMAIL);
    });

    // A text costs, and is for the guest with a phone and nothing else.
    it('reaches a guest by SMS only when nothing else will', () => {
      const withSms = [...EVERYTHING, MessageChannel.SMS];
      expect(chooseChannel([sms(), email()], withSms)?.channel).toBe(MessageChannel.EMAIL);
      expect(chooseChannel([sms(), whatsapp()], withSms)?.channel).toBe(MessageChannel.WHATSAPP);
      expect(chooseChannel([sms()], withSms)).toEqual({ channel: MessageChannel.SMS, address: '+37410000000' });
    });

    it('does not choose SMS where no provider is configured', () => {
      expect(chooseChannel([sms()], EVERYTHING)).toBeNull();
    });

    it('returns the address belonging to the channel it chose', () => {
      expect(chooseChannel([whatsapp(), email()], EVERYTHING)?.address).toBe('+37410000000');
    });
  });

  describe('opt-in', () => {
    /**
     * A Telegram bot cannot message someone who has not started a conversation
     * with it. An address recorded without an opt-in is unusable, and using it
     * would queue a message that can only fail.
     */
    it('will not use Telegram without an opt-in', () => {
      expect(chooseChannel([telegram(false)], EVERYTHING)).toBeNull();
    });

    it('skips past an un-opted-in Telegram to a channel that works', () => {
      expect(chooseChannel([telegram(false), email()], EVERYTHING)?.channel).toBe(
        MessageChannel.EMAIL,
      );
    });

    // WhatsApp and email can reach someone cold, so no opt-in is required.
    it.each([whatsapp(), email()])('needs no opt-in for %s', (address) => {
      expect(chooseChannel([address], EVERYTHING)).not.toBeNull();
    });
  });

  describe('what the server can actually send', () => {
    /**
     * Offering a channel with no credentials configured would queue messages
     * that can only fail — and on WhatsApp, fail after the host believed the
     * guest had been written to.
     */
    it('ignores a channel that is not configured', () => {
      expect(chooseChannel([telegram(), email()], [MessageChannel.EMAIL])?.channel).toBe(
        MessageChannel.EMAIL,
      );
    });

    it('returns null when nothing it holds is configured', () => {
      expect(chooseChannel([telegram(), whatsapp()], [MessageChannel.EMAIL])).toBeNull();
    });

    it('returns null when no channel is configured at all', () => {
      expect(chooseChannel([email()], [])).toBeNull();
    });
  });

  describe('addresses that are not addresses', () => {
    it.each(['', '   '])('ignores a blank address (%s)', (address) => {
      expect(chooseChannel([{ ...email(), address }], EVERYTHING)).toBeNull();
    });

    it('returns null for no addresses at all', () => {
      expect(chooseChannel([], EVERYTHING)).toBeNull();
    });
  });
});

describe('unreachableReason', () => {
  it('says plainly when there is nothing on file', () => {
    expect(unreachableReason([], EVERYTHING)).toContain('No email address');
  });

  /**
   * The distinction a host needs: an address we have but cannot use yet is a
   * different problem from no address at all, and the action differs.
   */
  it('explains a Telegram address still waiting for an opt-in', () => {
    expect(unreachableReason([telegram(false)], EVERYTHING)).toContain('Telegram link');
  });

  it('explains a channel we hold but have not configured', () => {
    expect(unreachableReason([whatsapp()], [MessageChannel.EMAIL])).toContain('not configured');
  });
});
