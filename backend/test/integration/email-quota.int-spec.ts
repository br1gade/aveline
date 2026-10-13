import { PrismaService } from '../../src/prisma/prisma.service';
import { EmailQuotaService } from '../../src/modules/communications/email-quota.service';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { utcDayStart } from '../../src/modules/communications/email-quota';
import { MessageChannel } from '@prisma/client';
import type { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('durable shared email budget', () => {
  const prisma = testPrisma();
  const previous = { minute: process.env.EMAIL_SENDS_PER_MINUTE, daily: process.env.EMAIL_SENDS_PER_DAY, burst: process.env.EMAIL_SEND_BURST };
  beforeEach(async () => {
    await resetTestDatabase();
    process.env.EMAIL_SENDS_PER_MINUTE = '1';
    process.env.EMAIL_SENDS_PER_DAY = '2';
    process.env.EMAIL_SEND_BURST = '1';
  });
  afterAll(async () => {
    for (const [key, value] of Object.entries({ EMAIL_SENDS_PER_MINUTE: previous.minute, EMAIL_SENDS_PER_DAY: previous.daily, EMAIL_SEND_BURST: previous.burst })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await disconnectTestDatabase();
  });

  it('allows only one concurrent reservation of the final provider slot', async () => {
    const quota = new EmailQuotaService(prisma as unknown as PrismaService);
    const reservations = await Promise.all(Array.from({ length: 10 }, () => quota.reserve()));
    expect(reservations.filter((next) => next === null)).toHaveLength(1);
    expect((await prisma.emailSendQuota.findUniqueOrThrow({ where: { scope: 'email' } })).usedToday).toBe(1);
  });

  it('retains the budget when the dispatcher is reconstructed', async () => {
    await new EmailQuotaService(prisma as unknown as PrismaService).reserve();
    const next = await new EmailQuotaService(prisma as unknown as PrismaService).reserve();
    expect(next).toBeInstanceOf(Date);
    expect((await prisma.emailSendQuota.findUniqueOrThrow({ where: { scope: 'email' } })).usedToday).toBe(1);
  });

  it('does not consume the daily budget for a denied reservation', async () => {
    const quota = new EmailQuotaService(prisma as unknown as PrismaService);
    await quota.reserve();
    await quota.reserve();
    expect((await prisma.emailSendQuota.findUniqueOrThrow({ where: { scope: 'email' } })).usedToday).toBe(1);
  });

  it('leaves a quota-blocked message queued with no consumed retry attempt', async () => {
    await prisma.emailSendQuota.create({ data: { scope: 'email', credits: 0n, refilledAt: new Date(), dayStartedAt: utcDayStart(new Date()), usedToday: 2 } });
    const row = await prisma.message.create({ data: { channel: 'EMAIL', toAddress: 'guest@example.test', body: 'Synthetic' } });
    const send = jest.fn().mockResolvedValue({ isDelivered: false });
    const transport: MessageTransport = { channel: MessageChannel.EMAIL, send };
    const database = prisma as unknown as PrismaService;
    const communications = new CommunicationsService(database, new Map([[MessageChannel.EMAIL, transport]]), new SuppressionService(database));
    await communications.dispatchDue();
    const message = await prisma.message.findUniqueOrThrow({ where: { id: row.id } });
    expect(message.status).toBe('QUEUED');
    expect(message.attempts).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
