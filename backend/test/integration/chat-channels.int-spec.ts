import { issueTelegramOptIn, telegramStartCode, telegramStartUpdate, TEST_TELEGRAM_BOT } from '../fixtures/telegram-opt-in.fixture';
import { ConfigService } from '@nestjs/config';
import { MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import { ConsoleTransport } from '../../src/modules/communications/channels/console.transport';
import {
  DeliveryResult,
  MessageTransport,
  OutboundMessage,
} from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { GuestChannelsService } from '../../src/modules/communications/guest-channels.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { TelegramWebhookController } from '../../src/modules/communications/telegram-webhook.controller';
import { InvitationSenderService } from '../../src/modules/invitations/sending/invitation-sender.service';
import { ReminderService } from '../../src/modules/invitations/sending/reminder.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MESSAGE_COPY } from '../../src/seed/message-copy';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;

const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

/** Records what each channel was asked to send. */
class RecordingTransport implements MessageTransport {
  readonly sent: OutboundMessage[] = [];

  constructor(readonly channel: MessageChannel) {}

  send(message: OutboundMessage): Promise<DeliveryResult> {
    this.sent.push(message);
    return Promise.resolve({ providerRef: `ref-${this.sent.length}`, isDelivered: true });
  }
}

/**
 * Telegram and WhatsApp end to end, against real rows.
 *
 * The flow this covers is the one the Telegram platform forces: a guest cannot
 * be messaged until they have started a conversation with the bot, so the
 * invitation goes by email, the guest taps a deep link, and the reminder goes
 * to Telegram. Each piece is unit-tested; this is where they meet.
 */
describe('chat channels (integration)', () => {
  let prisma: PrismaClient;
  let sender: InvitationSenderService;
  let reminders: ReminderService;
  let communications: CommunicationsService;
  let guestChannels: GuestChannelsService;
  let suppressions: SuppressionService;
  let webhook: TelegramWebhookController;
  let telegram: RecordingTransport;
  let email: RecordingTransport;

  /** Every channel configured, so preference is what decides. */
  const allChannels = configOf({
    PUBLIC_APP_URL: 'https://aveline.test',
    SMTP_HOST: 'smtp.test',
    MAIL_FROM: 'Aveline <hello@aveline.test>',
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_BOT_USERNAME: TEST_TELEGRAM_BOT,
  });

  beforeAll(() => {
    prisma = testPrisma();
    const service = prisma as unknown as PrismaService;
    suppressions = new SuppressionService(service);
    guestChannels = new GuestChannelsService(service);
    telegram = new RecordingTransport(MessageChannel.TELEGRAM);
    email = new RecordingTransport(MessageChannel.EMAIL);

    const transports = new Map<MessageChannel, MessageTransport>([
      [MessageChannel.EMAIL, email],
      [MessageChannel.TELEGRAM, telegram],
      [MessageChannel.WHATSAPP, new ConsoleTransport(MessageChannel.WHATSAPP)],
    ]);
    communications = new CommunicationsService(service, transports, suppressions);
    sender = new InvitationSenderService(service, communications, guestChannels, allChannels);
    reminders = new ReminderService(service, communications, guestChannels, allChannels);
    webhook = new TelegramWebhookController(
      service,
      guestChannels,
      suppressions,
      allChannels,
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    telegram.sent.length = 0;
    email.sent.length = 0;
  });

  afterAll(() => disconnectTestDatabase());

  /** An event with copy for both channels and one contactable guest. */
  const eventWithCopy = async (channels: MessageChannel[]) => {
    const seeded = await seedEvent(prisma);
    const event = await prisma.event.update({
      where: { id: seeded.eventId },
      data: { startsAt: new Date(Date.now() + 10 * DAY_MS) },
    });

    for (const key of ['invitation.send', 'rsvp.reminder']) {
      for (const channel of channels) {
        await prisma.messageTemplate.create({
          data: {
            organizationId: event.organizationId,
            key,
            channel,
            subject: { hy: 'Հրավեր {{hosts}}-ից' },
            body: { hy: '{{guestName}} — {{link}}' },
          },
        });
      }
    }

    await prisma.guest.updateMany({
      where: { eventId: event.id },
      data: { email: 'primary@test.local' },
    });
    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId: event.id } });

    return { ...seeded, event, guest };
  };

  const linkChat = async (guestToken: string, chatId: number) => {
    const { code, messageId } = await issueTelegramOptIn(prisma, guestToken);
    await webhook.receive(telegramStartUpdate(code, chatId));
    await prisma.message.delete({ where: { id: messageId } });
  };

  describe('the Telegram opt-in', () => {
    it('records the chat id from a deep-link /start', async () => {
      const { guest } = await eventWithCopy([MessageChannel.EMAIL]);

      await linkChat(guest.token, 987654321);

      const channel = await prisma.guestChannel.findFirstOrThrow({
        where: { guestId: guest.id, channel: MessageChannel.TELEGRAM },
      });
      expect(channel.address).toBe('987654321');
      // The timestamp is the evidence the guest performed the opt-in.
      expect(channel.optedInAt).not.toBeNull();
    });

    // Telling a stranger whether a token is real is the one thing this
    // endpoint must not do.
    it('ignores an unrecognised token without complaining', async () => {
      await eventWithCopy([MessageChannel.EMAIL]);

      await expect(
        webhook.receive({ message: { chat: { id: 1, type: 'private' }, text: '/start not-a-real-token' } }),
      ).resolves.toEqual({ ok: true });
      expect(await prisma.guestChannel.count()).toBe(0);
    });

    it('never links a guest who asked to be erased', async () => {
      const { guest } = await eventWithCopy([MessageChannel.EMAIL]);
      const { code } = await issueTelegramOptIn(prisma, guest.token);
      await prisma.guest.update({
        where: { id: guest.id },
        data: { anonymizedAt: new Date() },
      });

      await webhook.receive(telegramStartUpdate(code, 1));

      expect(await prisma.guestChannel.count()).toBe(0);
    });

    // A second device replaces the first, so a guest cannot receive every
    // message twice.
    it('replaces the chat id when the guest opts in again', async () => {
      const { guest } = await eventWithCopy([MessageChannel.EMAIL]);

      await linkChat(guest.token, 111);
      await linkChat(guest.token, 222);

      const channels = await prisma.guestChannel.findMany({ where: { guestId: guest.id } });
      expect(channels).toHaveLength(1);
      expect(channels[0].address).toBe('222');
    });

    it('consumes a code once across concurrent private chats and ignores group updates', async () => {
      const { guest } = await eventWithCopy([MessageChannel.EMAIL]);
      const { code } = await issueTelegramOptIn(prisma, guest.token);
      await webhook.receive({ message: { chat: { id: -700, type: 'group' }, text: `/start ${code}` } });
      expect(await prisma.guestChannel.count()).toBe(0);
      await Promise.all([111, 222].map((chatId) => webhook.receive(telegramStartUpdate(code, chatId))));
      const channel = await prisma.guestChannel.findFirstOrThrow({ where: { guestId: guest.id } });
      expect(['111', '222']).toContain(channel.address);
      await webhook.receive(telegramStartUpdate(code, 333));
      expect(await prisma.guestChannel.findUniqueOrThrow({ where: { id: channel.id } })).toEqual(channel);
      const chatId = Number(channel.address);
      await webhook.receive({ my_chat_member: { chat: { id: chatId, type: 'private' }, new_chat_member: { status: 'kicked' } } });
      await webhook.receive(telegramStartUpdate(code, chatId));
      expect(await suppressions.isSuppressed(MessageChannel.TELEGRAM, channel.address, null)).toBe(true);
      expect(await prisma.guestChannel.count()).toBe(0);
    });

    it('rejects codes for a different bot, rotated invitation credential, or past expiry', async () => {
      const { guest } = await eventWithCopy([MessageChannel.EMAIL]);
      const different = await issueTelegramOptIn(prisma, guest.token, 'DifferentBot');
      const rotated = await issueTelegramOptIn(prisma, guest.token);
      await prisma.guest.update({ where: { id: guest.id }, data: { token: 'replacement-guest-link' } });
      const expired = await issueTelegramOptIn(prisma, 'replacement-guest-link');
      await prisma.message.update({ where: { id: expired.messageId }, data: { telegramOptInExpiresAt: new Date(0) } });
      for (const { code } of [different, rotated, expired]) await webhook.receive(telegramStartUpdate(code, 123));
      expect(await prisma.guestChannel.count()).toBe(0);
    });

    it('ignores a message that is not a /start', async () => {
      await eventWithCopy([MessageChannel.EMAIL]);

      await webhook.receive({ message: { chat: { id: 1, type: 'private' }, text: 'hello there' } });

      expect(await prisma.guestChannel.count()).toBe(0);
    });
  });

  describe('a guest blocking the bot', () => {
    /**
     * Both halves matter: the suppression stops us writing to that chat, and
     * forgetting the address stops the sender choosing Telegram at all — so
     * the guest falls back to email rather than silently receiving nothing.
     */
    it('suppresses the chat and forgets the address', async () => {
      const { guest } = await eventWithCopy([MessageChannel.EMAIL, MessageChannel.TELEGRAM]);
      await linkChat(guest.token, 555);

      await webhook.receive({
        my_chat_member: { chat: { id: 555, type: 'private' }, new_chat_member: { status: 'kicked' } },
      });

      expect(
        await suppressions.isSuppressed(MessageChannel.TELEGRAM, '555', guest.eventId),
      ).toBe(true);
      expect(await prisma.guestChannel.count({ where: { guestId: guest.id } })).toBe(0);
    });

    // B21: blocking suppressed the chat for good; starting the bot again
    // changed nothing, and a guest who came back heard nothing there.
    it('lifts the suppression when the guest starts the bot again from their link', async () => {
      const { slug, guest } = await eventWithCopy([MessageChannel.EMAIL, MessageChannel.TELEGRAM]);
      await sender.send(slug);
      await prisma.message.updateMany({ where: { templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });
      await linkChat(guest.token, 555);
      await webhook.receive({ my_chat_member: { chat: { id: 555, type: 'private' }, new_chat_member: { status: 'kicked' } } });

      await linkChat(guest.token, 555);

      expect(await suppressions.isSuppressed(MessageChannel.TELEGRAM, '555', guest.eventId)).toBe(false);
      const reminder = await reminders.remindNow(slug);
      expect(reminder.recipients[0]).toMatchObject({ channel: MessageChannel.TELEGRAM });
    });

    it('lifts the suppression when the guest unblocks the bot', async () => {
      const { guest } = await eventWithCopy([MessageChannel.EMAIL, MessageChannel.TELEGRAM]);
      await linkChat(guest.token, 555);
      await webhook.receive({ my_chat_member: { chat: { id: 555, type: 'private' }, new_chat_member: { status: 'kicked' } } });

      await webhook.receive({ my_chat_member: { chat: { id: 555, type: 'private' }, new_chat_member: { status: 'member' } } });

      expect(await suppressions.isSuppressed(MessageChannel.TELEGRAM, '555', guest.eventId)).toBe(false);
    });

    it('leaves the guest reachable by email afterwards', async () => {
      const { slug, guest } = await eventWithCopy([
        MessageChannel.EMAIL,
        MessageChannel.TELEGRAM,
      ]);
      await linkChat(guest.token, 555);
      await webhook.receive({
        my_chat_member: { chat: { id: 555, type: 'private' }, new_chat_member: { status: 'kicked' } },
      });

      await sender.send(slug);
      await communications.dispatchDue();

      expect(email.sent).toHaveLength(1);
      expect(telegram.sent).toHaveLength(0);
    });
  });

  describe('which channel a message takes', () => {
    it('sends the invitation by email, because Telegram cannot be first', async () => {
      const { slug } = await eventWithCopy([MessageChannel.EMAIL, MessageChannel.TELEGRAM]);

      const result = await sender.send(slug);
      await communications.dispatchDue();

      expect(result.recipients[0].channel).toBe(MessageChannel.EMAIL);
      expect(email.sent).toHaveLength(1);
    });

    /**
     * The sequence the whole design is for: invitation by email, guest opts
     * in, reminder goes to Telegram — free, and read sooner.
     */
    it('sends the reminder over Telegram once the guest has opted in', async () => {
      const { slug, guest } = await eventWithCopy([
        MessageChannel.EMAIL,
        MessageChannel.TELEGRAM,
      ]);
      await sender.send(slug);
      await prisma.message.updateMany({ where: { templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });
      await linkChat(guest.token, 777);

      const result = await reminders.remindNow(slug);
      await communications.dispatchDue();

      expect(result.recipients[0].channel).toBe(MessageChannel.TELEGRAM);
      expect(telegram.sent[0]).toMatchObject({ toAddress: '777' });
      expect(telegram.sent[0].body).toContain(`/invitations/${slug}/g/${guest.token}`);
    });

    /**
     * An organization that has written no Telegram copy keeps getting email,
     * with nothing to configure. Choosing a channel with no template would
     * fail mid-send, after some households had already been written to.
     */
    it('stays on email when there is no Telegram copy', async () => {
      const { slug, guest } = await eventWithCopy([MessageChannel.EMAIL]);
      await sender.send(slug);
      await prisma.message.updateMany({ where: { templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });
      await linkChat(guest.token, 777);

      const result = await reminders.remindNow(slug);

      expect(result.recipients[0].channel).toBe(MessageChannel.EMAIL);
    });

    it('records which channel each message went out on', async () => {
      const { slug, guest, event } = await eventWithCopy([
        MessageChannel.EMAIL,
        MessageChannel.TELEGRAM,
      ]);
      await sender.send(slug);
      await prisma.message.updateMany({ where: { templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });
      await linkChat(guest.token, 777);
      await reminders.remindNow(slug);

      const messages = await prisma.message.findMany({
        where: { eventId: event.id },
        orderBy: { createdAt: 'asc' },
        select: { channel: true, templateKey: true, status: true },
      });
      expect(messages).toEqual([
        { channel: MessageChannel.EMAIL, templateKey: 'invitation.send', status: MessageStatus.QUEUED },
        { channel: MessageChannel.TELEGRAM, templateKey: 'rsvp.reminder', status: MessageStatus.QUEUED },
      ]);
    });

    // Suppression is per channel, so opting out of Telegram must not stop
    // email. B21: the reminder used to choose the suppressed chat anyway, and
    // the guest received nothing.
    it('reaches the guest by email when their Telegram is suppressed', async () => {
      const { slug, guest, event } = await eventWithCopy([
        MessageChannel.EMAIL,
        MessageChannel.TELEGRAM,
      ]);
      await sender.send(slug);
      await prisma.message.updateMany({ where: { templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });
      await linkChat(guest.token, 777);
      await suppressions.suppress({
        organizationId: event.organizationId,
        channel: MessageChannel.TELEGRAM,
        address: '777',
        reason: 'UNSUBSCRIBED',
      });

      const reminder = await reminders.remindNow(slug);

      expect(reminder.queued).toBe(1);
      expect(reminder.recipients[0]).toMatchObject({ channel: MessageChannel.EMAIL, toAddress: 'primary@test.local' });
    });

    it('still reports a suppressed address when it is the only one', async () => {
      const { slug, event } = await eventWithCopy([MessageChannel.EMAIL]);
      await suppressions.suppress({
        organizationId: event.organizationId,
        channel: MessageChannel.EMAIL,
        address: 'primary@test.local',
        reason: 'UNSUBSCRIBED',
      });

      const result = await sender.send(slug);

      expect(result.suppressed).toEqual([expect.objectContaining({ toAddress: 'primary@test.local' })]);
    });
  });

  // B72 (decided 10 October 2026, D13): with Aveline's own copy — not copy
  // written by the test — Telegram was never chosen, because none existed,
  // and the invitation never offered the bot at all.
  describe('with Aveline\'s own copy', () => {
    const withSeededCopy = async (config: ConfigService) => {
      const seeded = await seedEvent(prisma);
      await prisma.event.update({ where: { id: seeded.eventId }, data: { startsAt: new Date(Date.now() + 10 * DAY_MS) } });
      await prisma.guest.updateMany({ where: { eventId: seeded.eventId }, data: { email: 'primary@test.local' } });
      for (const template of MESSAGE_COPY) {
        await prisma.messageTemplate.create({ data: { organizationId: null, ...template } });
      }
      const service = prisma as unknown as PrismaService;
      return {
        ...seeded,
        sender: new InvitationSenderService(service, communications, guestChannels, config),
        reminders: new ReminderService(service, communications, guestChannels, config),
      };
    };
    const withBot = configOf({ PUBLIC_APP_URL: 'https://aveline.test', SMTP_HOST: 'smtp.test', MAIL_FROM: 'a@b.c', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_USERNAME: TEST_TELEGRAM_BOT });

    it('offers the bot in the invitation email with a separate opt-in code', async () => {
      const { slug, sender: botSender, primaryGuestToken } = await withSeededCopy(withBot);

      await botSender.send(slug);

      const invitation = await prisma.message.findFirstOrThrow({ where: { templateKey: 'invitation.send' } });
      expect(invitation.body).toContain(`/g/${primaryGuestToken}`);
      expect(telegramStartCode(invitation.body)).not.toBe(primaryGuestToken);
      expect(invitation.telegramOptInDigest).toMatch(/^[a-f0-9]{64}$/u);
    });

    it('removes the legacy bot URL from queued mail while keeping the invitation link', async () => {
      const { slug, sender: botSender, primaryGuestToken } = await withSeededCopy(withBot);
      await botSender.send(slug);
      const message = await prisma.message.findFirstOrThrow({ where: { templateKey: 'invitation.send' } });
      const link = `https://aveline.test/invitations/${slug}/g/${primaryGuestToken}`;
      await prisma.message.update({ where: { id: message.id }, data: {
        telegramOptInDigest: null, body: `${link}\nhttps://t.me/AvelineBot?start=${primaryGuestToken}`,
      } });
      await communications.dispatchDue();
      expect(email.sent[0].body).toContain(link);
      expect(email.sent[0].body).not.toContain('t.me/');
    });

    it('leaves the offer out when no bot is configured', async () => {
      const { slug, sender: plainSender } = await withSeededCopy(configOf({ PUBLIC_APP_URL: 'https://aveline.test', SMTP_HOST: 'smtp.test', MAIL_FROM: 'a@b.c' }));

      await plainSender.send(slug);

      const invitation = await prisma.message.findFirstOrThrow({ where: { templateKey: 'invitation.send' } });
      expect(invitation.body).not.toContain('Telegram');
    });

    it('reminds a guest who opened the bot on Telegram', async () => {
      const { slug, sender: botSender, reminders: botReminders } = await withSeededCopy(withBot);
      await botSender.send(slug);
      await communications.dispatchDue();
      await webhook.receive(telegramStartUpdate(telegramStartCode(email.sent[0].body), 4242));
      await prisma.message.updateMany({ data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });

      const result = await botReminders.remindNow(slug);

      expect(result.recipients[0]).toMatchObject({ channel: MessageChannel.TELEGRAM, toAddress: '4242' });
    });
  });

  describe('WhatsApp templates', () => {
    /**
     * WhatsApp will not accept free text, so the provider template and its
     * positional parameters are resolved at enqueue and stored — for the same
     * reason the body is, so what was sent stays knowable.
     */
    it('resolves the provider template and its parameters at enqueue', async () => {
      const { event } = await eventWithCopy([MessageChannel.EMAIL]);
      await prisma.messageTemplate.create({
        data: {
          organizationId: event.organizationId,
          key: 'invitation.send',
          channel: MessageChannel.WHATSAPP,
          subject: {},
          body: { hy: '{{guestName}} — {{link}}' },
          providerTemplate: 'invitation_v1',
          providerParams: ['guestName', 'hosts', 'link'],
        },
      });

      const message = await communications.enqueue({
        organizationId: event.organizationId,
        eventId: event.id,
        channel: MessageChannel.WHATSAPP,
        templateKey: 'invitation.send',
        toAddress: '+37410000000',
        locale: 'hy',
        variables: { guestName: 'Armen', hosts: 'A & B', link: 'https://x/y' },
      });

      expect(message.providerTemplate).toBe('invitation_v1');
      expect(message.providerParams).toEqual(['Armen', 'A & B', 'https://x/y']);
    });

    it('leaves the provider template empty for a channel that sends text', async () => {
      const { event } = await eventWithCopy([MessageChannel.EMAIL]);

      const message = await communications.enqueue({
        organizationId: event.organizationId,
        eventId: event.id,
        channel: MessageChannel.EMAIL,
        templateKey: 'invitation.send',
        toAddress: 'armen@test.local',
        locale: 'hy',
        variables: { guestName: 'Armen', hosts: 'A & B', link: 'https://x/y' },
      });

      expect(message.providerTemplate).toBeNull();
      expect(message.providerParams).toEqual([]);
    });
  });
});
