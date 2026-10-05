import { MessageChannel, MessageStatus, PrismaClient, SuppressionReason } from '@prisma/client';
import {
  DeliveryResult,
  MessageTransport,
  OutboundMessage,
} from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { MAX_DELIVERY_ATTEMPTS } from '../../src/modules/communications/delivery-outcome';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/** A transport that fails the way a mail server does, on demand. */
class FailingTransport implements MessageTransport {
  readonly channel = MessageChannel.EMAIL;
  readonly sent: OutboundMessage[] = [];
  private failure: Error | null = null;

  failWith(error: Error): void {
    this.failure = error;
  }

  succeed(): void {
    this.failure = null;
  }

  send(message: OutboundMessage): Promise<DeliveryResult> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.sent.push(message);
    return Promise.resolve({ providerRef: `ok-${this.sent.length}`, isDelivered: false });
  }
}

const smtpError = (responseCode: number, response: string) =>
  Object.assign(new Error(response), { responseCode, response, code: 'EENVELOPE' });

/**
 * What the outbox does when a send fails.
 *
 * These are integration tests because the behaviour under test is state in
 * Postgres across several dispatch passes — a message's attempt count, its
 * next due time and whether a suppression row appeared.
 */
describe('message delivery (integration)', () => {
  let prisma: PrismaClient;
  let communications: CommunicationsService;
  let suppressions: SuppressionService;
  let transport: FailingTransport;
  let organizationId: string;

  beforeAll(() => {
    prisma = testPrisma();
    suppressions = new SuppressionService(prisma as unknown as PrismaService);
    transport = new FailingTransport();
    communications = new CommunicationsService(
      prisma as unknown as PrismaService,
      new Map<MessageChannel, MessageTransport>([[MessageChannel.EMAIL, transport]]),
      suppressions,
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    transport.succeed();
    const seeded = await seedEvent(prisma);
    organizationId = (
      await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } })
    ).organizationId;
    await prisma.messageTemplate.create({
      data: {
        organizationId,
        key: 'invitation',
        channel: MessageChannel.EMAIL,
        subject: { hy: 'Հրավեր' },
        body: { hy: 'Բարև' },
      },
    });
  });

  afterAll(() => disconnectTestDatabase());

  const enqueue = (toAddress = 'ani@test.local') =>
    communications.enqueue({
      organizationId,
      channel: MessageChannel.EMAIL,
      templateKey: 'invitation',
      toAddress,
      locale: 'hy',
      variables: {},
    });

  /** Pretends the backoff has elapsed, so a retry is due now. */
  const makeDue = async (messageId: string) => {
    await prisma.message.update({
      where: { id: messageId },
      data: { scheduledFor: new Date(Date.now() - 1_000) },
    });
  };

  describe('a recipient that refuses', () => {
    it('marks the message bounced rather than failed', async () => {
      const message = await enqueue();
      transport.failWith(smtpError(550, '550 5.1.1 No such user here'));

      const result = await communications.dispatchDue();

      expect(result).toMatchObject({ sent: 0, failed: 1, retrying: 0 });
      const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.status).toBe(MessageStatus.BOUNCED);
      expect(after.failureReason).toContain('No such user here');
    });

    /**
     * Suppressed platform-wide, not per organization: a dead mailbox is dead
     * for everyone, and continuing to write to it damages the sending domain's
     * reputation for every customer.
     */
    it('suppresses the address platform-wide', async () => {
      await enqueue();
      transport.failWith(smtpError(550, '550 no such user'));

      await communications.dispatchDue();

      const row = await prisma.suppression.findFirstOrThrow({
        where: { address: 'ani@test.local' },
      });
      expect(row.organizationId).toBeNull();
      expect(row.reason).toBe(SuppressionReason.HARD_BOUNCE);
      expect(row.notes).toContain('no such user');
    });

    it('never attempts that address again', async () => {
      await enqueue();
      transport.failWith(smtpError(550, '550 no such user'));
      await communications.dispatchDue();
      transport.succeed();

      const second = await enqueue();

      expect(second.status).toBe(MessageStatus.SUPPRESSED);
      expect(await communications.dispatchDue()).toMatchObject({ sent: 0 });
    });
  });

  describe('a provider that cannot take it now', () => {
    /**
     * The defect this closes. Before a real transport existed every failure
     * was final, so a momentary blip would have permanently lost an
     * invitation — the one message in the product that cannot simply be sent
     * again by a human who notices.
     */
    it('puts the message back in the queue instead of losing it', async () => {
      const message = await enqueue();
      transport.failWith(smtpError(451, '451 greylisted, try later'));

      const result = await communications.dispatchDue();

      expect(result).toMatchObject({ sent: 0, failed: 0, retrying: 1 });
      const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.status).toBe(MessageStatus.QUEUED);
      expect(after.attempts).toBe(1);
      expect(after.failureReason).toContain('greylisted');
    });

    it('holds it back until the backoff has elapsed', async () => {
      await enqueue();
      transport.failWith(smtpError(451, '451 try later'));
      await communications.dispatchDue();
      transport.succeed();

      // The retry is scheduled into the future, so this pass finds nothing.
      expect(await communications.dispatchDue()).toMatchObject({ sent: 0, retrying: 0 });
    });

    it('sends it once the provider recovers', async () => {
      const message = await enqueue();
      transport.failWith(smtpError(451, '451 try later'));
      await communications.dispatchDue();
      transport.succeed();
      await makeDue(message.id);

      expect(await communications.dispatchDue()).toMatchObject({ sent: 1 });
      const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.status).toBe(MessageStatus.SENT);
      // The stale reason must not outlive the failure it described.
      expect(after.failureReason).toBeNull();
    });

    it('gives up after a bounded number of attempts', async () => {
      const message = await enqueue();
      transport.failWith(smtpError(451, '451 try later'));

      for (let pass = 0; pass < MAX_DELIVERY_ATTEMPTS + 1; pass += 1) {
        await makeDue(message.id);
        await communications.dispatchDue();
      }

      const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.status).toBe(MessageStatus.FAILED);
      expect(after.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
      expect(after.failureReason).toContain('gave up');
    });

    // A timeout is ours or the network's, never the guest's fault.
    it('does not suppress the address', async () => {
      await enqueue();
      transport.failWith(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));

      await communications.dispatchDue();

      expect(await prisma.suppression.count()).toBe(0);
    });
  });

  describe('a transport we have configured wrongly', () => {
    // Our bad password must not cost a guest their invitation, nor get their
    // address suppressed.
    it('retries and suppresses nobody', async () => {
      const message = await enqueue();
      transport.failWith(Object.assign(new Error('535 auth failed'), { code: 'EAUTH' }));

      const result = await communications.dispatchDue();

      expect(result).toMatchObject({ retrying: 1 });
      expect(await prisma.suppression.count()).toBe(0);
      const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.status).toBe(MessageStatus.QUEUED);
    });
  });

  describe('a channel with no transport at all', () => {
    it('fails the message rather than hanging it', async () => {
      await prisma.messageTemplate.create({
        data: {
          organizationId,
          key: 'invitation',
          channel: MessageChannel.SMS,
          subject: {},
          body: { hy: 'Բարև' },
        },
      });
      const message = await communications.enqueue({
        organizationId,
        channel: MessageChannel.SMS,
        templateKey: 'invitation',
        toAddress: '+37410000000',
        locale: 'hy',
        variables: {},
      });

      await communications.dispatchDue();

      const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.status).toBe(MessageStatus.FAILED);
      expect(after.failureReason).toContain('No transport');
    });
  });
});
