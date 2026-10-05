import { MessageChannel, MessageStatus, PrismaClient, SuppressionReason } from '@prisma/client';
import { ConsoleTransport } from '../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Suppression against real Postgres.
 *
 * Two reasons this cannot be a unit test: the scoping rule is a query (global
 * rows OR this organization's), and the global uniqueness it depends on is a
 * partial index that only Postgres enforces.
 */
describe('suppression (integration)', () => {
  let prisma: PrismaClient;
  let suppressions: SuppressionService;
  let communications: CommunicationsService;
  let organizationId: string;
  let otherOrganizationId: string;

  beforeAll(() => {
    prisma = testPrisma();
    suppressions = new SuppressionService(prisma as unknown as PrismaService);
    const transports = new Map<MessageChannel, MessageTransport>(
      Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]),
    );
    communications = new CommunicationsService(
      prisma as unknown as PrismaService,
      transports,
      suppressions,
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    const seeded = await seedEvent(prisma);
    organizationId = (
      await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } })
    ).organizationId;
    const other = await prisma.organization.create({ data: { name: 'Another Host' } });
    otherOrganizationId = other.id;

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

  const enqueue = (toAddress: string, orgId = organizationId) =>
    communications.enqueue({
      organizationId: orgId,
      channel: MessageChannel.EMAIL,
      templateKey: 'invitation',
      toAddress,
      locale: 'hy',
      variables: {},
    });

  describe('scope', () => {
    it('suppresses an address for one organization only', async () => {
      await suppressions.suppress({
        organizationId,
        channel: MessageChannel.EMAIL,
        address: 'ani@test.local',
        reason: SuppressionReason.UNSUBSCRIBED,
      });

      expect(
        await suppressions.isSuppressed(MessageChannel.EMAIL, 'ani@test.local', organizationId),
      ).toBe(true);
      expect(
        await suppressions.isSuppressed(
          MessageChannel.EMAIL,
          'ani@test.local',
          otherOrganizationId,
        ),
      ).toBe(false);
    });

    /**
     * A hard bounce is not one host's business: continuing to send to a dead
     * address damages deliverability for every customer on the platform.
     */
    it('suppresses an address everywhere when the row is global', async () => {
      await suppressions.suppress({
        organizationId: null,
        channel: MessageChannel.EMAIL,
        address: 'dead@test.local',
        reason: SuppressionReason.HARD_BOUNCE,
      });

      for (const org of [organizationId, otherOrganizationId]) {
        expect(await suppressions.isSuppressed(MessageChannel.EMAIL, 'dead@test.local', org)).toBe(
          true,
        );
      }
    });

    it('does not suppress a different channel', async () => {
      await suppressions.suppress({
        organizationId,
        channel: MessageChannel.EMAIL,
        address: '+37410000000',
        reason: SuppressionReason.UNSUBSCRIBED,
      });

      expect(
        await suppressions.isSuppressed(MessageChannel.SMS, '+37410000000', organizationId),
      ).toBe(false);
    });

    // Suppression is worthless if case lets an address through.
    it.each(['ANI@test.local', ' ani@TEST.local ', 'Ani@Test.Local'])(
      'matches %s against a suppression recorded in lower case',
      async (variant) => {
        await suppressions.suppress({
          organizationId,
          channel: MessageChannel.EMAIL,
          address: 'ani@test.local',
          reason: SuppressionReason.UNSUBSCRIBED,
        });

        expect(
          await suppressions.isSuppressed(MessageChannel.EMAIL, variant, organizationId),
        ).toBe(true);
      },
    );
  });

  describe('recording', () => {
    it('is idempotent for an organization row', async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await suppressions.suppress({
          organizationId,
          channel: MessageChannel.EMAIL,
          address: 'ani@test.local',
          reason: SuppressionReason.UNSUBSCRIBED,
        });
      }

      expect(await prisma.suppression.count({ where: { address: 'ani@test.local' } })).toBe(1);
    });

    /**
     * The defect this guards: the compound unique includes a nullable column,
     * and in Postgres two NULLs never conflict — so without the partial index
     * the same address could be suppressed platform-wide many times over.
     */
    it('is idempotent for a global row, even under concurrency', async () => {
      await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          suppressions.suppress({
            organizationId: null,
            channel: MessageChannel.EMAIL,
            address: 'dead@test.local',
            reason: SuppressionReason.HARD_BOUNCE,
          }),
        ),
      );

      expect(
        await prisma.suppression.count({
          where: { organizationId: null, address: 'dead@test.local' },
        }),
      ).toBe(1);
    });

    it('lets a stronger reason replace a weaker one', async () => {
      await suppressions.suppress({
        organizationId,
        channel: MessageChannel.EMAIL,
        address: 'ani@test.local',
        reason: SuppressionReason.UNSUBSCRIBED,
      });
      await suppressions.suppress({
        organizationId,
        channel: MessageChannel.EMAIL,
        address: 'ani@test.local',
        reason: SuppressionReason.COMPLAINT,
      });

      const row = await prisma.suppression.findFirstOrThrow({
        where: { address: 'ani@test.local' },
      });
      expect(row.reason).toBe(SuppressionReason.COMPLAINT);
    });

    // One customer must not be able to undo a platform-wide bounce.
    it('refuses to remove a global suppression', async () => {
      await suppressions.suppress({
        organizationId: null,
        channel: MessageChannel.EMAIL,
        address: 'dead@test.local',
        reason: SuppressionReason.HARD_BOUNCE,
      });
      const row = await prisma.suppression.findFirstOrThrow({ where: { organizationId: null } });

      await expect(suppressions.unsuppress(organizationId, row.id)).rejects.toThrow(
        /platform-wide/,
      );
    });

    it('removes an organization’s own suppression', async () => {
      const row = await suppressions.suppress({
        organizationId,
        channel: MessageChannel.EMAIL,
        address: 'ani@test.local',
        reason: SuppressionReason.UNSUBSCRIBED,
      });

      await suppressions.unsuppress(organizationId, row.id);

      expect(
        await suppressions.isSuppressed(MessageChannel.EMAIL, 'ani@test.local', organizationId),
      ).toBe(false);
    });

    it('will not let one organization remove another’s', async () => {
      const row = await suppressions.suppress({
        organizationId,
        channel: MessageChannel.EMAIL,
        address: 'ani@test.local',
        reason: SuppressionReason.UNSUBSCRIBED,
      });

      await expect(suppressions.unsuppress(otherOrganizationId, row.id)).rejects.toThrow();
    });
  });

  describe('what the outbox does with it', () => {
    it('records a message to a suppressed address instead of sending it', async () => {
      await suppressions.suppress({
        organizationId,
        channel: MessageChannel.EMAIL,
        address: 'ani@test.local',
        reason: SuppressionReason.UNSUBSCRIBED,
      });

      const message = await enqueue('ani@test.local');

      // Recorded, not dropped: a host asking why a guest never heard from
      // them deserves the answer.
      expect(message.status).toBe(MessageStatus.SUPPRESSED);
      expect(message.failureReason).toMatch(/suppressed/i);
    });

    it('never dispatches it', async () => {
      await suppressions.suppress({
        organizationId,
        channel: MessageChannel.EMAIL,
        address: 'ani@test.local',
        reason: SuppressionReason.UNSUBSCRIBED,
      });
      await enqueue('ani@test.local');

      const result = await communications.dispatchDue();

      expect(result.sent).toBe(0);
    });

    /**
     * The case queue-time checking alone would miss: a reminder can sit in the
     * outbox for weeks, and an unsubscribe in between must still stop it.
     */
    it('stops a queued message when the address is suppressed afterwards', async () => {
      const message = await enqueue('ani@test.local');
      expect(message.status).toBe(MessageStatus.QUEUED);

      await suppressions.suppress({
        organizationId,
        channel: MessageChannel.EMAIL,
        address: 'ani@test.local',
        reason: SuppressionReason.UNSUBSCRIBED,
      });
      const result = await communications.dispatchDue();

      expect(result).toMatchObject({ sent: 0, suppressed: 1 });
      const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.status).toBe(MessageStatus.SUPPRESSED);
    });

    it('still sends to everyone else', async () => {
      await suppressions.suppress({
        organizationId,
        channel: MessageChannel.EMAIL,
        address: 'ani@test.local',
        reason: SuppressionReason.UNSUBSCRIBED,
      });
      await enqueue('ani@test.local');
      await enqueue('armen@test.local');

      const result = await communications.dispatchDue();

      expect(result.sent).toBe(1);
    });
  });
});
