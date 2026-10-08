import { ConfigService } from '@nestjs/config';
import { MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import { AccountService } from '../../src/infra/auth/account.service';
import { ConsoleTransport } from '../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

/**
 * The mail that belongs to no tenant.
 *
 * All three of these flows returned `{ sent: true }` and sent nothing. In
 * development that was hidden by the `devLink` in the response; in production,
 * where `devLink` is absent by design, a user who forgot their password could
 * never reset it and a team member could never be invited. `{ sent: true }`
 * was simply untrue — the worst kind of defect here, because it looks exactly
 * like success.
 *
 * Integration rather than unit, because what was missing is a row: these tests
 * assert a `Message` exists, addressed to the right person, carrying a link.
 */
describe('platform mail (integration)', () => {
  let prisma: PrismaClient;
  let accounts: AccountService;
  let communications: CommunicationsService;

  beforeAll(() => {
    prisma = testPrisma();
    const service = prisma as unknown as PrismaService;
    const transports = new Map<MessageChannel, MessageTransport>(
      Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]),
    );
    communications = new CommunicationsService(
      service,
      transports,
      new SuppressionService(service),
    );
    accounts = new AccountService(
      service,
      communications,
      configOf({ PUBLIC_APP_URL: 'https://aveline.test', DEFAULT_LOCALE: 'hy' }),
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    // Aveline's own copy, which these flows render. `organizationId` is null,
    // the same as a real deployment's seeded defaults.
    for (const key of ['account.password-reset', 'account.verify-email', 'organization.invite']) {
      await prisma.messageTemplate.create({
        data: {
          organizationId: null,
          key,
          channel: MessageChannel.EMAIL,
          subject: { hy: 'Aveline' },
          body: { hy: '{{link}}' },
        },
      });
    }
  });

  afterAll(() => disconnectTestDatabase());

  const aUser = (email = 'host@test.local') =>
    prisma.user.create({
      data: { email, name: 'Anna', passwordHash: 'x', isActive: true },
    });

  const mailTo = (toAddress: string) =>
    prisma.message.findFirst({ where: { toAddress }, orderBy: { createdAt: 'desc' } });

  describe('a password reset', () => {
    it('queues an email carrying the reset link', async () => {
      const user = await aUser();

      const result = await accounts.requestPasswordReset(user.email);

      expect(result.sent).toBe(true);
      const message = await mailTo(user.email);
      expect(message).not.toBeNull();
      expect(message?.templateKey).toBe('account.password-reset');
      expect(message?.body).toContain('https://aveline.test/reset-password?token=');
    });

    /**
     * Platform mail has no tenant, which is why `Message.organizationId`
     * became nullable: it was NOT NULL, and that is the reason these flows
     * never used the outbox in the first place.
     */
    it('records it against no organization', async () => {
      const user = await aUser();

      await accounts.requestPasswordReset(user.email);

      expect((await mailTo(user.email))?.organizationId).toBeNull();
    });

    it('goes out through the same outbox as everything else', async () => {
      const user = await aUser();
      await accounts.requestPasswordReset(user.email);

      await communications.dispatchDue();

      expect((await mailTo(user.email))?.status).toBe(MessageStatus.DELIVERED);
    });

    /**
     * Whether an address has an account is information worth not leaking, so
     * the response is identical — and no mail is queued for an address that
     * has none.
     */
    it('answers the same for an unknown address, and queues nothing', async () => {
      const result = await accounts.requestPasswordReset('nobody@test.local');

      expect(result).toEqual({ sent: true });
      expect(await mailTo('nobody@test.local')).toBeNull();
    });

    // A guest who unsubscribed from one host's events must still be able to
    // reset their own password.
    it('is not stopped by an organization’s own suppression', async () => {
      const user = await aUser();
      const organization = await prisma.organization.create({ data: { name: 'Some Host' } });
      await prisma.suppression.create({
        data: {
          organizationId: organization.id,
          channel: MessageChannel.EMAIL,
          address: user.email,
          reason: 'UNSUBSCRIBED',
        },
      });

      await accounts.requestPasswordReset(user.email);

      expect((await mailTo(user.email))?.status).toBe(MessageStatus.QUEUED);
    });

    // A global suppression means the address itself is undeliverable.
    it('is stopped by a platform-wide suppression', async () => {
      const user = await aUser();
      await prisma.suppression.create({
        data: {
          organizationId: null,
          channel: MessageChannel.EMAIL,
          address: user.email,
          reason: 'HARD_BOUNCE',
        },
      });

      await accounts.requestPasswordReset(user.email);

      expect((await mailTo(user.email))?.status).toBe(MessageStatus.SUPPRESSED);
    });
  });

  describe('an email verification', () => {
    it('queues an email to the account being verified', async () => {
      const user = await aUser();

      await accounts.requestEmailVerification(user.id);

      const message = await mailTo(user.email);
      expect(message?.templateKey).toBe('account.verify-email');
      expect(message?.body).toContain('/verify-email?token=');
    });
  });

  describe('an organization invite', () => {
    it('queues an email naming the organization', async () => {
      const user = await aUser('owner@test.local');
      const organization = await prisma.organization.create({ data: { name: 'Petrosyan' } });

      await accounts.inviteMember(organization.id, user.id, {
        email: 'planner@test.local',
        role: 'MANAGER',
      });

      const message = await mailTo('planner@test.local');
      expect(message?.templateKey).toBe('organization.invite');
      expect(message?.body).toContain('/accept-invite?token=');
    });

    // The invite is to join this organization, so it is attributed to it.
    it('records it against the organization being joined', async () => {
      const user = await aUser('owner@test.local');
      const organization = await prisma.organization.create({ data: { name: 'Petrosyan' } });

      await accounts.inviteMember(organization.id, user.id, {
        email: 'planner@test.local',
        role: 'MANAGER',
      });

      expect((await mailTo('planner@test.local'))?.organizationId).toBe(organization.id);
    });
  });

  /**
   * The token has already been issued by the time mail is queued, so a
   * failure to queue must not fail the request: the user would be told their
   * reset failed when the link is valid and the next sweep would deliver it.
   */
  it('still reports success when the copy is missing', async () => {
    await prisma.messageTemplate.deleteMany({ where: { key: 'account.password-reset' } });
    const user = await aUser();

    await expect(accounts.requestPasswordReset(user.email)).resolves.toMatchObject({ sent: true });
    expect(await mailTo(user.email)).toBeNull();
  });
});
