import { randomUUID } from 'node:crypto';
import { EmailFeedbackOutcome, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EmailFeedbackService } from '../../src/modules/communications/email-feedback.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import type { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { MessageChannel } from '@prisma/client';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('normalized email feedback', () => {
  const prisma = testPrisma();
  const suppressions = new SuppressionService(prisma as unknown as PrismaService);
  const feedback = new EmailFeedbackService(prisma as unknown as PrismaService, suppressions);
  let messageId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    const { eventId } = await seedEvent(prisma);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    messageId = (await prisma.message.create({ data: {
      organizationId: event.organizationId, eventId, channel: 'EMAIL', toAddress: 'guest@example.test',
      body: 'Synthetic', status: 'SENT', sentAt: new Date(),
    } })).id;
  });
  afterAll(() => disconnectTestDatabase());
  const report = (outcome: EmailFeedbackOutcome, receiptKey = randomUUID()) => ({ receiptKey, messageId, outcome, occurredAt: new Date().toISOString() });

  it('applies concurrent duplicate feedback once', async () => {
    const input = report(EmailFeedbackOutcome.HARD_BOUNCE);
    await Promise.all(Array.from({ length: 5 }, () => feedback.receive(input)));
    expect(await prisma.emailFeedback.count()).toBe(1);
    expect(await prisma.suppression.count()).toBe(1);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).status).toBe(MessageStatus.BOUNCED);
  });

  it('does not downgrade a complaint when delivery and bounce reports arrive later', async () => {
    await feedback.receive(report(EmailFeedbackOutcome.COMPLAINT));
    await feedback.receive(report(EmailFeedbackOutcome.DELIVERED));
    await feedback.receive(report(EmailFeedbackOutcome.HARD_BOUNCE));
    expect((await prisma.suppression.findFirstOrThrow()).reason).toBe('COMPLAINT');
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).failureReason).toBe('Email complaint reported');
  });

  it('records a temporary bounce without suppressing the address', async () => {
    await feedback.receive(report(EmailFeedbackOutcome.SOFT_BOUNCE));
    expect(await prisma.suppression.count()).toBe(0);
    await feedback.receive(report(EmailFeedbackOutcome.DELIVERED));
    const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(message.status).toBe(MessageStatus.DELIVERED);
    expect(message.failureReason).toBeNull();
  });

  it('does not reconstruct an erased address from a late callback', async () => {
    await prisma.message.update({ where: { id: messageId }, data: { toAddress: '[erased]', body: '[erased]' } });
    await feedback.receive(report(EmailFeedbackOutcome.COMPLAINT));
    expect(await prisma.suppression.count()).toBe(0);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).toAddress).toBe('[erased]');
  });

  it('keeps early feedback pending until the message enters sending', async () => {
    await prisma.message.update({ where: { id: messageId }, data: { status: 'QUEUED', sentAt: null } });
    await feedback.receive(report(EmailFeedbackOutcome.DELIVERED));
    expect((await prisma.emailFeedback.findFirstOrThrow()).processedAt).toBeNull();
    await prisma.message.update({ where: { id: messageId }, data: { status: 'SENDING' } });
    await feedback.reconcile();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).status).toBe(MessageStatus.DELIVERED);
  });

  it('keeps unmatched receipts without holding addresses or provider payloads', async () => {
    await feedback.receive({ ...report(EmailFeedbackOutcome.DELIVERED), messageId: 'not-yet-known' });
    const receipt = await prisma.emailFeedback.findFirstOrThrow();
    expect(receipt.processedAt).toBeNull();
    expect(receipt).not.toHaveProperty('recipient');
    expect(receipt).not.toHaveProperty('payload');
  });

  it.each([EmailFeedbackOutcome.HARD_BOUNCE, EmailFeedbackOutcome.DELIVERED])('preserves %s feedback that arrives before SMTP acknowledgement', async (outcome) => {
    await prisma.message.update({ where: { id: messageId }, data: { status: 'QUEUED', sentAt: null } });
    const transport: MessageTransport = { channel: MessageChannel.EMAIL, send: async (message) => {
      expect(message.messageId).toBe(messageId);
      await feedback.receive(report(outcome));
      return { isDelivered: false, providerRef: 'synthetic-provider-reference' };
    } };
    const communications = new CommunicationsService(prisma as unknown as PrismaService, new Map([[MessageChannel.EMAIL, transport]]), suppressions);
    await communications.dispatchDue();
    const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(message.status).toBe(outcome === EmailFeedbackOutcome.DELIVERED ? 'DELIVERED' : 'BOUNCED');
    expect(message.providerRef).toBe('synthetic-provider-reference');
  });

  it('does not let fifty unmatched receipts starve a known message indefinitely', async () => {
    await prisma.emailFeedback.createMany({ data: Array.from({ length: 50 }, (_, index) => ({ receiptKey: `unknown-${index}`, messageId: `unknown-${index}`, outcome: 'DELIVERED', occurredAt: new Date() })) });
    await prisma.message.update({ where: { id: messageId }, data: { status: 'QUEUED' } });
    await feedback.receive(report(EmailFeedbackOutcome.DELIVERED));
    await prisma.message.update({ where: { id: messageId }, data: { status: 'SENDING' } });
    await feedback.reconcile();
    await feedback.reconcile();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).status).toBe('DELIVERED');
  });
});
