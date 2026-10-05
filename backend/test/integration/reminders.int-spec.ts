import { ConfigService } from '@nestjs/config';
import { MessageChannel, MessageStatus, PrismaClient, RsvpStatus } from '@prisma/client';
import { ConsoleTransport } from '../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { GuestChannelsService } from '../../src/modules/communications/guest-channels.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { InvitationSenderService } from '../../src/modules/invitations/sending/invitation-sender.service';
import { ReminderService } from '../../src/modules/invitations/sending/reminder.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A ConfigService that answers only the keys it is given. */
const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

/**
 * Chasing non-responders, which is the work hosts most want taken off them.
 *
 * Integration rather than unit, because every rule worth testing is a question
 * about rows: who has not answered, who was actually invited, and whether a
 * reminder already exists. The schedule arithmetic is unit-tested separately.
 */
describe('reminders (integration)', () => {
  let prisma: PrismaClient;
  let reminders: ReminderService;
  let sender: InvitationSenderService;
  let communications: CommunicationsService;

  beforeAll(() => {
    prisma = testPrisma();
    const suppressions = new SuppressionService(prisma as unknown as PrismaService);
    const transports = new Map<MessageChannel, MessageTransport>(
      Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]),
    );
    communications = new CommunicationsService(
      prisma as unknown as PrismaService,
      transports,
      suppressions,
    );
    const config = configOf({ PUBLIC_APP_URL: 'https://aveline.test' });
    const guestChannels = new GuestChannelsService(prisma as unknown as PrismaService);
    sender = new InvitationSenderService(
      prisma as unknown as PrismaService,
      communications,
      guestChannels,
      config,
    );
    reminders = new ReminderService(
      prisma as unknown as PrismaService,
      communications,
      guestChannels,
      config,
    );
  });

  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  /** An event `daysAway` in the future, invited, with nobody having answered. */
  const invitedEvent = async (daysAway: number) => {
    const seeded = await seedEvent(prisma);
    const event = await prisma.event.update({
      where: { id: seeded.eventId },
      data: { startsAt: new Date(Date.now() + daysAway * DAY_MS) },
    });

    for (const key of ['invitation.send', 'rsvp.reminder']) {
      await prisma.messageTemplate.create({
        data: {
          organizationId: event.organizationId,
          key,
          channel: MessageChannel.EMAIL,
          subject: { hy: 'Հրավեր {{hosts}}-ից' },
          body: { hy: '{{guestName}} — {{link}}' },
        },
      });
    }

    await prisma.guest.updateMany({
      where: { eventId: event.id },
      data: { email: 'primary@test.local' },
    });

    return { ...seeded, event };
  };

  const remindersFor = (eventId: string) =>
    prisma.message.count({ where: { eventId, templateKey: 'rsvp.reminder' } });

  describe('who gets chased', () => {
    it('reminds a household that was invited and has not answered', async () => {
      const { slug, eventId } = await invitedEvent(10);
      await sender.send(slug);

      const result = await reminders.remindNow(slug);

      expect(result.queued).toBe(1);
      expect(await remindersFor(eventId)).toBe(1);
    });

    /**
     * Reminding someone about an invitation they never received reads as an
     * accusation, and the thing to do for them is send the invitation.
     */
    it('does not chase a guest who was never invited', async () => {
      const { slug, eventId } = await invitedEvent(10);

      const result = await reminders.remindNow(slug);

      expect(result.queued).toBe(0);
      expect(await remindersFor(eventId)).toBe(0);
    });

    // Chasing someone who already declined is what turns a reminder into a
    // nuisance.
    it.each([RsvpStatus.ATTENDING, RsvpStatus.DECLINED])(
      'does not chase a guest who answered %s',
      async (status) => {
        const { slug, eventId } = await invitedEvent(10);
        await sender.send(slug);
        await prisma.rsvp.updateMany({ where: { guest: { eventId } }, data: { status } });

        const result = await reminders.remindNow(slug);

        expect(result.queued).toBe(0);
      },
    );

    /**
     * A guest created by a path that has not written an RSVP row yet has not
     * answered either. Never chasing them is a failure nobody notices, which
     * is why this is asserted rather than assumed.
     */
    it('chases a guest who has no RSVP row at all', async () => {
      const { slug, eventId } = await invitedEvent(10);
      const household = await prisma.household.create({
        data: { eventId, name: 'No Rsvp Row', seatsAllotted: 1 },
      });
      await prisma.guest.create({
        data: {
          eventId,
          householdId: household.id,
          firstName: 'Tigran',
          email: 'tigran@test.local',
          isPrimary: true,
          token: 'tok-tigran-no-rsvp',
        },
      });
      await sender.send(slug);

      const result = await reminders.remindNow(slug);

      expect(result.recipients.map((entry) => entry.toAddress)).toContain('tigran@test.local');
    });

    it('renders the guest’s own link into the reminder', async () => {
      const { slug, eventId } = await invitedEvent(10);
      await sender.send(slug);

      await reminders.remindNow(slug);

      const reminder = await prisma.message.findFirstOrThrow({
        where: { eventId, templateKey: 'rsvp.reminder' },
      });
      expect(reminder.body).toContain(`/invitations/${slug}/g/`);
    });
  });

  describe('how often', () => {
    /**
     * A host clicking twice must not write to a guest twice, but following up
     * again tomorrow must still be possible — so the limit is one a day.
     */
    it('reminds at most once a day, however many times it is pressed', async () => {
      const { slug, eventId } = await invitedEvent(10);
      await sender.send(slug);

      const first = await reminders.remindNow(slug);
      const second = await reminders.remindNow(slug);

      expect(first.queued).toBe(1);
      expect(second).toMatchObject({ queued: 0, alreadyRemindedToday: 1 });
      expect(await remindersFor(eventId)).toBe(1);
    });

    it('refuses once the event has started', async () => {
      const { slug } = await invitedEvent(-1);

      await expect(reminders.remindNow(slug)).rejects.toThrow(/already started/);
    });

    it('refuses an unpublished invitation', async () => {
      const seeded = await seedEvent(prisma, { isPublished: false });
      await prisma.event.update({
        where: { id: seeded.eventId },
        data: { startsAt: new Date(Date.now() + 10 * DAY_MS) },
      });

      await expect(reminders.remindNow(seeded.slug)).rejects.toThrow(/published/);
    });
  });

  describe('the scheduled sweep', () => {
    it('sends nothing for an event beyond the first milestone', async () => {
      const { slug, eventId } = await invitedEvent(40);
      await sender.send(slug);

      expect(await reminders.sendDueReminders()).toMatchObject({ queued: 0 });
      expect(await remindersFor(eventId)).toBe(0);
    });

    it.each([21, 14, 7, 3, 2, 1])('sends one reminder %s days out', async (daysAway) => {
      const { slug, eventId } = await invitedEvent(daysAway);
      await sender.send(slug);

      const result = await reminders.sendDueReminders();

      expect(result.queued).toBe(1);
      expect(await remindersFor(eventId)).toBe(1);
    });

    /**
     * What makes an hourly sweep safe: the milestone's own dedupe key means
     * every run after the first is a no-op, with nothing to remember.
     */
    it('is a no-op when run again within the same milestone', async () => {
      const { slug, eventId } = await invitedEvent(10);
      await sender.send(slug);
      await reminders.sendDueReminders();

      for (let run = 0; run < 5; run += 1) await reminders.sendDueReminders();

      expect(await remindersFor(eventId)).toBe(1);
    });

    /**
     * The late-send case. An invitation going out three days before the event
     * has passed two milestones already; firing them all would send a guest
     * three emails in one minute.
     */
    it('sends one reminder, not three, for a late invitation', async () => {
      const { slug, eventId } = await invitedEvent(3);
      await sender.send(slug);

      await reminders.sendDueReminders();

      expect(await remindersFor(eventId)).toBe(1);
    });

    it('sends again when the next milestone comes into force', async () => {
      const { slug, eventId } = await invitedEvent(10);
      await sender.send(slug);
      await reminders.sendDueReminders();

      // The event is now two days away: a new milestone, so a new reminder.
      await prisma.event.update({
        where: { id: eventId },
        data: { startsAt: new Date(Date.now() + 2 * DAY_MS) },
      });
      await reminders.sendDueReminders();

      expect(await remindersFor(eventId)).toBe(2);
    });

    // Automatic sends write to guests without the host pressing anything, so
    // a host has to be able to refuse them.
    it('respects an event with reminders turned off', async () => {
      const { slug, eventId } = await invitedEvent(10);
      await sender.send(slug);
      await prisma.event.update({ where: { id: eventId }, data: { remindersEnabled: false } });

      expect(await reminders.sendDueReminders()).toMatchObject({ queued: 0 });
      expect(await remindersFor(eventId)).toBe(0);
    });

    it('skips an unpublished invitation', async () => {
      const seeded = await seedEvent(prisma, { isPublished: false });
      await prisma.event.update({
        where: { id: seeded.eventId },
        data: { startsAt: new Date(Date.now() + 10 * DAY_MS) },
      });

      expect(await reminders.sendDueReminders()).toMatchObject({ queued: 0 });
    });

    it('skips an event that has already happened', async () => {
      const { slug, eventId } = await invitedEvent(10);
      await sender.send(slug);
      await prisma.event.update({
        where: { id: eventId },
        data: { startsAt: new Date(Date.now() - DAY_MS) },
      });

      expect(await reminders.sendDueReminders()).toMatchObject({ queued: 0 });
      expect(await remindersFor(eventId)).toBe(0);
    });

    it('records a suppressed recipient rather than skipping them silently', async () => {
      const { slug, eventId, event } = await invitedEvent(10);
      await sender.send(slug);
      await prisma.suppression.create({
        data: {
          organizationId: event.organizationId,
          channel: MessageChannel.EMAIL,
          address: 'primary@test.local',
          reason: 'UNSUBSCRIBED',
        },
      });

      await reminders.sendDueReminders();

      const reminder = await prisma.message.findFirstOrThrow({
        where: { eventId, templateKey: 'rsvp.reminder' },
      });
      expect(reminder.status).toBe(MessageStatus.SUPPRESSED);
    });
  });

  it('dispatches reminders through the same outbox as everything else', async () => {
    const { slug, eventId } = await invitedEvent(10);
    await sender.send(slug);
    await reminders.remindNow(slug);

    const dispatched = await communications.dispatchDue();

    expect(dispatched.sent).toBe(2);
    const reminder = await prisma.message.findFirstOrThrow({
      where: { eventId, templateKey: 'rsvp.reminder' },
    });
    expect(reminder.status).toBe(MessageStatus.DELIVERED);
  });
});
