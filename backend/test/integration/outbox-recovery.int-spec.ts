import { MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import {
  DeliveryResult,
  MessageTransport,
  OutboundMessage,
} from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { MAX_DELIVERY_ATTEMPTS } from '../../src/modules/communications/delivery-outcome';
import { priorityFor } from '../../src/modules/communications/message-priority';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

class RecordingTransport implements MessageTransport {
  readonly channel = MessageChannel.EMAIL;
  readonly sent: string[] = [];

  send(message: OutboundMessage): Promise<DeliveryResult> {
    this.sent.push(message.toAddress);
    return Promise.resolve({ providerRef: `ok-${this.sent.length}`, isDelivered: false });
  }
}

/** A suppression lookup that fails for one address, the way a dropped connection does. */
class FlakySuppressions extends SuppressionService {
  failFor: string | null = null;

  override isSuppressed(channel: MessageChannel, address: string, organizationId: string | null) {
    if (address === this.failFor) return Promise.reject(new Error('connection reset'));
    return super.isSuppressed(channel, address, organizationId);
  }
}

/**
 * A message claimed for sending and then interrupted — a crash, a deploy, an
 * error between the claim and the send — used to stay SENDING forever. Nothing
 * returned it to the queue, and because SENDING counts as "on its way", that
 * guest was never sent their invitation and never retried. One such error also
 * abandoned the rest of the batch.
 */
describe('outbox recovery (integration)', () => {
  let prisma: PrismaClient;
  let communications: CommunicationsService;
  let suppressions: FlakySuppressions;
  let transport: RecordingTransport;
  let organizationId: string;

  beforeAll(() => {
    prisma = testPrisma();
    suppressions = new FlakySuppressions(prisma as unknown as PrismaService);
    transport = new RecordingTransport();
    communications = new CommunicationsService(
      prisma as unknown as PrismaService,
      new Map<MessageChannel, MessageTransport>([[MessageChannel.EMAIL, transport]]),
      suppressions,
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    transport.sent.length = 0;
    suppressions.failFor = null;
    const seeded = await seedEvent(prisma);
    organizationId = (await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } })).organizationId;
  });

  afterAll(() => disconnectTestDatabase());

  const message = (toAddress: string, extra: { status?: MessageStatus; attempts?: number } = {}) =>
    prisma.message.create({
      data: {
        organizationId,
        channel: MessageChannel.EMAIL,
        templateKey: 'invitation.send',
        toAddress,
        body: 'Dear guest',
        locale: 'hy',
        status: extra.status ?? MessageStatus.QUEUED,
        attempts: extra.attempts ?? 0,
      },
    });

  /** What a crash leaves behind: claimed, and last touched this long ago. */
  const strandedFor = async (minutes: number, extra: { attempts?: number } = {}) => {
    const row = await message('stranded@test.local', { status: MessageStatus.SENDING, attempts: extra.attempts ?? 1 });
    await prisma.$executeRaw`
      UPDATE messages SET "updatedAt" = now() - make_interval(mins => ${minutes}::int) WHERE id = ${row.id}`;
    return row;
  };

  const statusOf = async (id: string) => (await prisma.message.findUniqueOrThrow({ where: { id } })).status;

  it('sends a message that was stranded mid-send on a later run', async () => {
    const stranded = await strandedFor(20);

    await communications.dispatchDue();

    expect(await statusOf(stranded.id)).toBe(MessageStatus.SENT);
    expect(transport.sent).toEqual(['stranded@test.local']);
  });

  // A send can legitimately take minutes — mail-server timeouts are long.
  it('leaves alone a message that is being sent right now', async () => {
    const inFlight = await strandedFor(2);

    await communications.dispatchDue();

    expect(await statusOf(inFlight.id)).toBe(MessageStatus.SENDING);
    expect(transport.sent).toEqual([]);
  });

  it('gives up on a stranded message that has no attempts left', async () => {
    const exhausted = await strandedFor(20, { attempts: MAX_DELIVERY_ATTEMPTS });

    await communications.dispatchDue();

    const row = await prisma.message.findUniqueOrThrow({ where: { id: exhausted.id } });
    expect(row.status).toBe(MessageStatus.FAILED);
    expect(row.failureReason).toMatch(/interrupted/i);
  });

  it('keeps going past a message that throws, and puts that one back in the queue', async () => {
    const broken = await message('broken@test.local');
    const fine = await message('fine@test.local');
    suppressions.failFor = 'broken@test.local';

    await communications.dispatchDue();

    expect(await statusOf(fine.id)).toBe(MessageStatus.SENT);
    const row = await prisma.message.findUniqueOrThrow({ where: { id: broken.id } });
    expect(row.status).toBe(MessageStatus.QUEUED);
    expect(row.scheduledFor.getTime()).toBeGreaterThan(Date.now());
  });

  /**
   * B19: the provider call and the "sent" update shared one error path, so a
   * database error after a successful send was read as a delivery failure and
   * the message went out again — up to five times.
   */
  describe('when recording a successful send fails', () => {
    /** The same database, except the "it was sent" write fails `times` times. */
    const withFailingSentRecord = (times: number) => {
      let remaining = times;
      const messages = new Proxy(prisma.message, {
        get(target, property, receiver) {
          if (property !== 'update') return Reflect.get(target, property, receiver) as unknown;
          return (args: { data: { sentAt?: unknown } }) => {
            if (args.data.sentAt !== undefined && remaining > 0) {
              remaining -= 1;
              return Promise.reject(new Error('connection reset'));
            }
            return target.update(args as Parameters<typeof target.update>[0]);
          };
        },
      });
      const database = new Proxy(prisma, {
        get: (target, property, receiver) => (property === 'message' ? messages : Reflect.get(target, property, receiver)) as unknown,
      });
      return new CommunicationsService(
        database as unknown as PrismaService,
        new Map<MessageChannel, MessageTransport>([[MessageChannel.EMAIL, transport]]),
        suppressions,
      );
    };

    it('records it on a second try, and does not send again', async () => {
      const row = await message('guest@test.local');

      await withFailingSentRecord(1).dispatchDue();

      expect(transport.sent).toEqual(['guest@test.local']);
      expect(await statusOf(row.id)).toBe(MessageStatus.SENT);
    });

    it('never puts a sent message back in the queue, even when the record cannot be written', async () => {
      const row = await message('guest@test.local');
      const outbox = withFailingSentRecord(Number.POSITIVE_INFINITY);

      await outbox.dispatchDue();
      await prisma.message.updateMany({ where: { id: row.id }, data: { scheduledFor: new Date(0) } });
      await outbox.dispatchDue();

      expect(transport.sent).toEqual(['guest@test.local']);
      expect(await statusOf(row.id)).not.toBe(MessageStatus.QUEUED);
    });
  });

  // B80: 50 a run, one at a time, in one queue — a large send held password
  // resets and tickets back by minutes.
  describe('throughput and priority', () => {
    const queued = (toAddress: string, templateKey: string) =>
      prisma.message.create({
        data: { organizationId, channel: MessageChannel.EMAIL, templateKey, toAddress, body: 'Hi', locale: 'hy', priority: priorityFor(templateKey) },
      });

    it('sends everything due in one run, not fifty', async () => {
      for (let index = 0; index < 120; index += 1) await queued(`guest${index}@test.local`, 'invitation.send');

      await communications.dispatchDue();

      expect(transport.sent).toHaveLength(120);
    });

    it('sends account and ticket mail ahead of a bulk send queued first', async () => {
      for (let index = 0; index < 60; index += 1) await queued(`guest${index}@test.local`, 'invitation.send');
      await queued('owner@test.local', 'account.password-reset');

      await communications.dispatchDue();

      expect(transport.sent.indexOf('owner@test.local')).toBeLessThan(5);
    });
  });
});
