import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockType, MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import { CacheService } from '../../../src/infra/cache/cache.service';
import { StorageService } from '../../../src/infra/storage/storage.service';
import { ConsoleTransport } from '../../../src/modules/communications/channels/console.transport';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { GuestChannelsService } from '../../../src/modules/communications/guest-channels.service';
import { SuppressionService } from '../../../src/modules/communications/suppression.service';
import { DesignService } from '../../../src/modules/design/design.service';
import { TemplateAdoptionService } from '../../../src/modules/design/templates/template-adoption.service';
import { TemplateGatesService } from '../../../src/modules/design/templates/template-gates.service';
import { InvitationSenderService } from '../../../src/modules/invitations/sending/invitation-sender.service';
import { ReminderService } from '../../../src/modules/invitations/sending/reminder.service';
import { MediaService } from '../../../src/modules/media/media.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Design and publishing rules that only show against real rows: a file
 * removed while a block is being given it, and messages queued before an
 * invitation expired.
 */
describe('Design and publishing coverage (integration)', () => {
  let prisma: PrismaClient;
  let database: PrismaService;
  const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;

  beforeAll(() => {
    prisma = testPrisma();
    database = prisma as unknown as PrismaService;
  });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  describe('removing a file while a block is being given it', () => {
    let design: DesignService;
    let media: MediaService;

    beforeAll(() => {
      const gates = new TemplateGatesService(new ConfigService({ TEMPLATE_ADOPTION_ENABLED: 'false' }));
      design = new DesignService(database, cache, new TemplateAdoptionService(database, cache, gates));
      media = new MediaService(database, { removeByUrl: jest.fn().mockResolvedValue(undefined) } as unknown as StorageService, cache);
    });
    afterEach(() => jest.restoreAllMocks());

    const photo = async () => {
      const { slug, eventId } = await seedEvent(prisma);
      const image = await prisma.mediaAsset.create({ data: { eventId, kind: 'PHOTO', url: 'https://media.test/hero.png' } });
      return { slug, eventId, image };
    };

    const heroAssets = async (slug: string) =>
      (await prisma.invitationBlock.findFirstOrThrow({ where: { invitation: { slug }, type: BlockType.HERO } })).assetIds;

    it('refuses the edit when the file disappears after it was checked, and leaves the block as it was', async () => {
      const { slug, eventId, image } = await photo();
      const designInternals = design as unknown as { assertAttachable: (...args: unknown[]) => Promise<void> };
      const check = designInternals.assertAttachable.bind(design);
      // The removal lands in the gap between the ownership check and the block write.
      jest.spyOn(designInternals, 'assertAttachable').mockImplementation(async (...args: unknown[]) => {
        await check(...args);
        await media.remove(eventId, image.id);
      });

      const edit = design.updateBlock(slug, BlockType.HERO, { assetIds: [image.id] });

      await expect(edit).rejects.toBeInstanceOf(BadRequestException);
      await expect(edit).rejects.toThrow('assetIds: one of these files was just removed');
      expect(await heroAssets(slug)).toEqual([]);
      expect(await prisma.mediaAsset.count({ where: { id: image.id } })).toBe(0);
    });

    it('never leaves the block showing a file that was removed at the same moment', async () => {
      const { slug, eventId, image } = await photo();

      const results = await Promise.allSettled([
        design.updateBlock(slug, BlockType.HERO, { assetIds: [image.id] }),
        media.remove(eventId, image.id),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const [refusal] = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      // Either the attach saw the file gone (400), or the removal saw it shown (409).
      expect([BadRequestException, ConflictException].some((kind) => refusal.reason instanceof kind)).toBe(true);
      const remaining = await prisma.mediaAsset.findUnique({ where: { id: image.id } });
      expect((await heroAssets(slug)).includes(image.id)).toBe(remaining !== null);
    });
  });

  describe('messages queued before the invitation expired', () => {
    let communications: CommunicationsService;
    let sender: InvitationSenderService;
    let reminders: ReminderService;
    let transports: Map<MessageChannel, ConsoleTransport>;

    beforeEach(() => {
      transports = new Map(Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]));
      communications = new CommunicationsService(database, transports, new SuppressionService(database));
      const config = { get: (key: string) => ({ PUBLIC_APP_URL: 'https://aveline.test' })[key] } as unknown as ConfigService;
      const guestChannels = new GuestChannelsService(database);
      sender = new InvitationSenderService(database, communications, guestChannels, config);
      reminders = new ReminderService(database, communications, guestChannels, config);
      sender.onModuleInit();
      reminders.onModuleInit();
    });

    const invitedEvent = async () => {
      const seeded = await seedEvent(prisma);
      const event = await prisma.event.update({ where: { id: seeded.eventId }, data: { startsAt: new Date(Date.now() + 7 * DAY_MS) } });
      for (const key of ['invitation.send', 'rsvp.reminder']) {
        await prisma.messageTemplate.create({ data: {
          organizationId: event.organizationId, key, channel: MessageChannel.EMAIL,
          subject: { hy: 'Հրավեր {{hosts}}-ից' }, body: { hy: '{{guestName}} — {{link}}' },
        } });
      }
      await prisma.guest.updateMany({ where: { eventId: event.id }, data: { email: 'primary@test.local' } });
      return seeded;
    };

    const expire = (slug: string) => prisma.invitation.update({ where: { slug }, data: { expiresAt: new Date(0) } });
    const outboxSize = () => [...transports.values()].reduce((total, transport) => total + transport.outbox().length, 0);

    it('cancels a queued invitation when it expires before dispatch, and sends nothing', async () => {
      const { slug, eventId } = await invitedEvent();
      await sender.send(slug);
      expect(await prisma.message.count({ where: { eventId, templateKey: 'invitation.send' } })).toBe(1);
      await expire(slug);

      await communications.dispatchDue();

      const message = await prisma.message.findFirstOrThrow({ where: { eventId, templateKey: 'invitation.send' } });
      expect(message).toMatchObject({ status: MessageStatus.CANCELLED, sentAt: null });
      expect(outboxSize()).toBe(0);
    });

    it('cancels both the invitation and the reminder queued before expiry, and none is sent or delivered', async () => {
      const { slug, eventId } = await invitedEvent();
      await sender.send(slug);
      await prisma.message.updateMany({ where: { templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });
      await reminders.remindNow(slug);
      await expire(slug);

      await communications.dispatchDue();

      const messages = await prisma.message.findMany({ where: { eventId }, orderBy: { templateKey: 'asc' }, select: { templateKey: true, status: true, sentAt: true } });
      expect(messages).toEqual([
        { templateKey: 'invitation.send', status: MessageStatus.CANCELLED, sentAt: null },
        { templateKey: 'rsvp.reminder', status: MessageStatus.CANCELLED, sentAt: null },
      ]);
      expect(outboxSize()).toBe(0);
    });

    it('still delivers a queued invitation whose deadline has not passed', async () => {
      const { slug, eventId } = await invitedEvent();
      await sender.send(slug);
      await prisma.invitation.update({ where: { slug }, data: { expiresAt: new Date(Date.now() + DAY_MS) } });

      await communications.dispatchDue();

      const message = await prisma.message.findFirstOrThrow({ where: { eventId, templateKey: 'invitation.send' } });
      expect(message.status).toBe(MessageStatus.DELIVERED);
      expect(outboxSize()).toBe(1);
    });
  });
});
