import { ConfigService } from '@nestjs/config';
import {
  DataSubjectRequestKind,
  DataSubjectRequestStatus,
  InvitationStatus,
  MessageChannel,
  MessageStatus,
  PrismaClient,
  RsvpStatus,
} from '@prisma/client';
import {
  DeliveryResult,
  MessageTransport,
  OutboundMessage,
} from '../../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { GuestChannelsService } from '../../../src/modules/communications/guest-channels.service';
import { SuppressionService } from '../../../src/modules/communications/suppression.service';
import { TelegramWebhookController } from '../../../src/modules/communications/telegram-webhook.controller';
import { InvitationSenderService } from '../../../src/modules/invitations/sending/invitation-sender.service';
import { ReminderService } from '../../../src/modules/invitations/sending/reminder.service';
import { RsvpConfirmerService } from '../../../src/modules/invitations/sending/rsvp-confirmer.service';
import { PrivacyService } from '../../../src/modules/privacy/privacy.service';
import { AnalyticsService } from '../../../src/infra/analytics/analytics.service';
import { AuditService } from '../../../src/infra/audit/audit.service';
import { StorageService } from '../../../src/infra/storage/storage.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRIMARY_EMAIL = 'primary@test.local';

const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

/**
 * Records what each channel was asked to send. Each send yields to the event
 * loop once before answering, so sweeps running side by side genuinely
 * interleave rather than finishing one after the other.
 */
class RecordingTransport implements MessageTransport {
  readonly sent: OutboundMessage[] = [];

  constructor(readonly channel: MessageChannel) {}

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.sent.push(message);
    return { providerRef: `ref-${this.sent.length}`, isDelivered: false };
  }
}

/**
 * Sending invitations and the outbox under the conditions a single sequential
 * press never reaches: presses and sweeps at the same moment, a guest whose
 * channels change between presses, and an invitation or guest that stops
 * applying while its message waits in the queue.
 */
describe('sending and communications (integration, coverage)', () => {
  let prisma: PrismaClient;
  let communications: CommunicationsService;
  let sender: InvitationSenderService;
  let reminders: ReminderService;
  let confirmer: RsvpConfirmerService;
  let webhook: TelegramWebhookController;
  let email: RecordingTransport;
  let telegram: RecordingTransport;

  beforeAll(() => {
    prisma = testPrisma();
    const service = prisma as unknown as PrismaService;
    const suppressions = new SuppressionService(service);
    const guestChannels = new GuestChannelsService(service);
    email = new RecordingTransport(MessageChannel.EMAIL);
    telegram = new RecordingTransport(MessageChannel.TELEGRAM);
    communications = new CommunicationsService(
      service,
      new Map<MessageChannel, MessageTransport>([
        [MessageChannel.EMAIL, email],
        [MessageChannel.TELEGRAM, telegram],
      ]),
      suppressions,
    );
    const config = configOf({
      PUBLIC_APP_URL: 'https://aveline.test',
      SMTP_HOST: 'smtp.test',
      MAIL_FROM: 'Aveline <hello@aveline.test>',
      TELEGRAM_BOT_TOKEN: 'bot-token',
    });
    sender = new InvitationSenderService(service, communications, guestChannels, config);
    reminders = new ReminderService(service, communications, guestChannels, config);
    confirmer = new RsvpConfirmerService(service, communications, guestChannels, config);
    // What Nest does at boot: each sender registers its last-moment check.
    sender.onModuleInit();
    reminders.onModuleInit();
    webhook = new TelegramWebhookController(service, guestChannels, suppressions, configOf({}));
  });

  beforeEach(async () => {
    await resetTestDatabase();
    email.sent.length = 0;
    telegram.sent.length = 0;
  });

  afterAll(() => disconnectTestDatabase());

  /** A published event ten days out, with copy on the given channels and a contactable primary guest. */
  const eventWithCopy = async (channels: MessageChannel[] = [MessageChannel.EMAIL]) => {
    const seeded = await seedEvent(prisma);
    const event = await prisma.event.update({
      where: { id: seeded.eventId },
      data: { startsAt: new Date(Date.now() + 10 * DAY_MS) },
    });
    for (const key of ['invitation.send', 'rsvp.reminder', 'event.details-changed', 'rsvp.confirmation.attending']) {
      for (const channel of channels) {
        await prisma.messageTemplate.create({
          data: {
            organizationId: event.organizationId,
            key,
            channel,
            subject: { hy: '{{hosts}}' },
            body: { hy: '{{guestName}} — {{link}}' },
          },
        });
      }
    }
    await prisma.guest.updateMany({ where: { eventId: event.id }, data: { email: PRIMARY_EMAIL } });
    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId: event.id } });
    return { ...seeded, event, guest };
  };

  /** Adds single-guest households, each with its own address. */
  const addHouseholds = async (eventId: string, count: number) => {
    for (let index = 0; index < count; index += 1) {
      await prisma.household.create({
        data: {
          eventId,
          name: `Family ${index}`,
          guests: {
            create: {
              eventId,
              firstName: `Guest${index}`,
              email: `guest${index}@test.local`,
              isPrimary: true,
              token: `sending-comms-${eventId}-${index}`,
            },
          },
        },
      });
    }
  };

  const invitationsOf = (eventId: string) =>
    prisma.message.findMany({ where: { eventId, templateKey: 'invitation.send' } });

  describe('pressing send several times at the same moment', () => {
    it('queues exactly one invitation per household, and no press fails', async () => {
      const { slug, eventId } = await eventWithCopy();
      await addHouseholds(eventId, 2);

      const presses = await Promise.allSettled([sender.send(slug), sender.send(slug), sender.send(slug)]);

      expect(presses.map((press) => press.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
      const messages = await invitationsOf(eventId);
      expect(messages).toHaveLength(3);
      expect(new Set(messages.map((message) => message.guestId)).size).toBe(3);
      for (const message of messages) expect(message.dedupeKey).toMatch(/:1$/);
    });
  });

  describe('a guest who links Telegram after being invited by email', () => {
    it('is reported as already sent and gets no second invitation on Telegram', async () => {
      const { slug, eventId, guest } = await eventWithCopy([MessageChannel.EMAIL, MessageChannel.TELEGRAM]);
      await sender.send(slug);
      await communications.dispatchDue();
      await webhook.receive({ message: { chat: { id: 777 }, text: `/start ${guest.token}` } });

      // The premise: the chat is linked, so Telegram is now this guest's preferred channel.
      expect(await prisma.guestChannel.findMany({ where: { guestId: guest.id }, select: { channel: true, address: true } }))
        .toEqual([{ channel: MessageChannel.TELEGRAM, address: '777' }]);

      const again = await sender.send(slug);
      await communications.dispatchDue();

      expect(again).toMatchObject({ queued: 0, alreadySent: 1 });
      const messages = await invitationsOf(eventId);
      expect(messages.map((message) => message.channel)).toEqual([MessageChannel.EMAIL]);
      expect(telegram.sent).toHaveLength(0);
      expect(email.sent).toHaveLength(1);
    });
  });

  describe('a guest who links Telegram after being invited by email, when the details change', () => {
    it('is told on Telegram, the channel they chose since, not the email the invitation went to', async () => {
      const { slug, eventId, guest } = await eventWithCopy([MessageChannel.EMAIL, MessageChannel.TELEGRAM]);
      await sender.send(slug);
      await communications.dispatchDue();
      await webhook.receive({ message: { chat: { id: 777 }, text: `/start ${guest.token}` } });

      const notified = await reminders.notifyDetailsChanged(slug, 'We have moved to the garden.');

      expect(notified.recipients).toEqual([expect.objectContaining({ channel: MessageChannel.TELEGRAM, toAddress: '777' })]);
      const notice = await prisma.message.findFirstOrThrow({ where: { eventId, templateKey: 'event.details-changed' } });
      expect(notice).toMatchObject({ channel: MessageChannel.TELEGRAM, toAddress: '777' });
    });

    it('has their answer confirmed on Telegram too', async () => {
      const { slug, eventId, guest } = await eventWithCopy([MessageChannel.EMAIL, MessageChannel.TELEGRAM]);
      await sender.send(slug);
      await communications.dispatchDue();
      await webhook.receive({ message: { chat: { id: 777 }, text: `/start ${guest.token}` } });

      await confirmer.confirm(guest.id, RsvpStatus.ATTENDING);

      const confirmation = await prisma.message.findFirstOrThrow({ where: { eventId, templateKey: 'rsvp.confirmation.attending' } });
      expect(confirmation).toMatchObject({ channel: MessageChannel.TELEGRAM, toAddress: '777' });
    });
  });

  describe('a host pressing remind before the invitation has reached anyone', () => {
    it('reminds nobody and still lists every undecided household, with what to do for each', async () => {
      const { slug, eventId } = await eventWithCopy();
      await prisma.household.create({
        data: { eventId, name: 'Aaa Unaddressed', guests: { create: { eventId, firstName: 'Nobody', isPrimary: true, token: `sending-comms-${eventId}-none` } } },
      });

      const reminded = await reminders.remindNow(slug);

      expect(reminded).toMatchObject({ queued: 0, recentlyInvited: 0, recipients: [] });
      expect(reminded.notInvited).toEqual([
        expect.objectContaining({ householdName: 'Aaa Unaddressed', reason: expect.stringMatching(/address/i) }),
        expect.objectContaining({ householdName: 'Fixture Household', reason: expect.stringMatching(/send it/) }),
      ]);
      expect(await prisma.message.count({ where: { eventId } })).toBe(0);
    });
  });

  describe('a queued message that no longer applies when it is due', () => {
    const closeInvitation = (slug: string) =>
      prisma.invitation.update({ where: { slug }, data: { status: InvitationStatus.CLOSED } });

    it('cancels a queued invitation once the invitation has been closed', async () => {
      const { slug, eventId } = await eventWithCopy();
      await sender.send(slug);
      await closeInvitation(slug);

      await communications.dispatchDue();

      expect((await invitationsOf(eventId)).map((message) => message.status)).toEqual([MessageStatus.CANCELLED]);
      expect(email.sent).toHaveLength(0);
    });

    it('cancels a queued reminder once the invitation has been closed', async () => {
      const { slug, eventId } = await eventWithCopy();
      await sender.send(slug);
      await communications.dispatchDue();
      await prisma.message.updateMany({ where: { templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });
      expect((await reminders.remindNow(slug)).queued).toBe(1);
      await closeInvitation(slug);
      email.sent.length = 0;

      await communications.dispatchDue();

      const reminder = await prisma.message.findFirstOrThrow({ where: { eventId, templateKey: 'rsvp.reminder' } });
      expect(reminder.status).toBe(MessageStatus.CANCELLED);
      expect(email.sent).toHaveLength(0);
    });

    it('cancels a queued invitation to a guest who has since been anonymised', async () => {
      const { slug, eventId, guest } = await eventWithCopy();
      await sender.send(slug);
      await prisma.guest.update({ where: { id: guest.id }, data: { anonymizedAt: new Date() } });

      await communications.dispatchDue();

      expect((await invitationsOf(eventId)).map((message) => message.status)).toEqual([MessageStatus.CANCELLED]);
      expect(email.sent).toHaveLength(0);
    });

    it('stops a queued invitation when the guest’s erasure is carried out, so nothing is ever sent', async () => {
      const { slug, eventId } = await eventWithCopy();
      await sender.send(slug);
      const privacy = new PrivacyService(
        prisma as unknown as PrismaService,
        { removeByUrl: () => Promise.resolve() } as unknown as StorageService,
        { forgetPerson: () => Promise.resolve() } as unknown as AuditService,
        { forgetGuests: () => Promise.resolve() } as unknown as AnalyticsService,
      );
      const request = await prisma.dataSubjectRequest.create({
        data: {
          kind: DataSubjectRequestKind.ERASURE,
          subjectEmail: PRIMARY_EMAIL,
          status: DataSubjectRequestStatus.IN_PROGRESS,
          dueAt: new Date(Date.now() + DAY_MS),
        },
      });
      await privacy.fulfil(request.id, 'staff-user');

      await communications.dispatchDue();

      const [message] = await invitationsOf(eventId);
      expect(message).toMatchObject({ status: MessageStatus.FAILED, sentAt: null });
      expect(email.sent).toHaveLength(0);
    });
  });

  describe('several dispatch sweeps at once', () => {
    it('sends every queued message exactly once between them', async () => {
      const { event } = await eventWithCopy();
      await prisma.message.createMany({
        data: Array.from({ length: 20 }, (_, index) => ({
          organizationId: event.organizationId,
          eventId: event.id,
          channel: MessageChannel.EMAIL,
          templateKey: 'outbox-race',
          toAddress: `race${index}@test.local`,
          body: 'Dear guest',
          locale: 'hy',
        })),
      });

      const sweeps = await Promise.all([
        communications.dispatchDue(),
        communications.dispatchDue(),
        communications.dispatchDue(),
      ]);

      expect(email.sent).toHaveLength(20);
      expect(new Set(email.sent.map((message) => message.toAddress)).size).toBe(20);
      expect(sweeps.reduce((total, sweep) => total + sweep.sent, 0)).toBe(20);
      const rows = await prisma.message.findMany({ where: { templateKey: 'outbox-race' }, select: { status: true, attempts: true } });
      expect(rows).toEqual(Array.from({ length: 20 }, () => ({ status: MessageStatus.SENT, attempts: 1 })));
    });
  });
});
