import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TelegramWebhookController } from '../../src/modules/communications/telegram-webhook.controller';
import { GuestChannelsService } from '../../src/modules/communications/guest-channels.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Guest opt-in availability (integration)', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());
  it.each(['expired', 'draft'])('does not register a Telegram channel through an %s invitation', async (state) => {
    const event = await seedEvent(prisma);
    await prisma.invitation.update({ where: { slug: event.slug }, data: state === 'expired' ? { expiresAt: new Date(0) } : { status: 'DRAFT' } });
    const database = prisma as unknown as PrismaService;
    const lift = jest.fn();
    const controller = new TelegramWebhookController(database, new GuestChannelsService(database), { liftAfterOptIn: lift } as unknown as SuppressionService,
      new ConfigService({ NODE_ENV: 'test', TELEGRAM_WEBHOOK_SECRET: '' }));
    await controller.receive({ message: { chat: { id: 123456789 }, text: `/start ${event.primaryGuestToken}` } });
    expect(await prisma.guestChannel.count()).toBe(0); expect(lift).not.toHaveBeenCalled();
  });
});
