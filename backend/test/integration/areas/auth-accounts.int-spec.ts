import { ConfigService } from '@nestjs/config';
import { MessageChannel, OrganizationRole, PlatformRole, PrismaClient } from '@prisma/client';
import { AccountService } from '../../../src/infra/auth/account.service';
import { ConsoleTransport } from '../../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { SuppressionService } from '../../../src/modules/communications/suppression.service';
import { OrganizationReviewsService } from '../../../src/modules/organizations/organization-reviews.service';
import { OrganizationsService } from '../../../src/modules/organizations/organizations.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const prisma: PrismaClient = testPrisma();
const database = prisma as unknown as PrismaService;
const organizations = new OrganizationsService(database);
const reviews = new OrganizationReviewsService(database);
const DAY_MS = 86_400_000;

function accountsIn(nodeEnv: string | undefined): AccountService {
  const values: Record<string, string | undefined> = { NODE_ENV: nodeEnv, PUBLIC_APP_URL: 'https://aveline.test', DEFAULT_LOCALE: 'hy' };
  const transports = new Map<MessageChannel, MessageTransport>(
    Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]),
  );
  return new AccountService(
    database,
    new CommunicationsService(database, transports, new SuppressionService(database)),
    { get: (key: string) => values[key] } as unknown as ConfigService,
  );
}

async function seedTemplates(): Promise<void> {
  await prisma.messageTemplate.createMany({
    data: ['account.password-reset', 'account.verify-email', 'organization.invite', 'event.invite'].map((key) => ({
      organizationId: null, key, channel: MessageChannel.EMAIL, subject: { hy: 'Aveline' }, body: { hy: '{{link}}' },
    })),
  });
}

const eventIn = (organizationId: string) =>
  prisma.event.create({ data: { organizationId, title: 'Family', type: 'WEDDING', hostsLabel: 'Family', startsAt: new Date(Date.now() + 30 * DAY_MS) } });

async function tenant(memberRole: OrganizationRole = 'MEMBER') {
  const organization = await prisma.organization.create({ data: { name: 'Family' } });
  const owner = await prisma.user.create({ data: { email: 'owner@test.local', name: 'Owner', passwordHash: 'x' } });
  const member = await prisma.user.create({ data: { email: 'member@test.local', name: 'Member', passwordHash: 'x' } });
  await prisma.organizationMembership.createMany({ data: [
    { userId: owner.id, organizationId: organization.id, role: 'OWNER' },
    { userId: member.id, organizationId: organization.id, role: memberRole },
  ] });
  const actorOf = (user: { id: string; email: string }, platformRole: PlatformRole = PlatformRole.NONE) => ({ userId: user.id, email: user.email, platformRole });
  return { organization, owner, member, ownerActor: actorOf(owner), memberActor: actorOf(member), actorOf };
}

const pendingInvite = { tokenHash: '', expiresAt: new Date(Date.now() + 7 * DAY_MS) };
const inviteRows = async (organizationId: string, email: string) => {
  const event = await eventIn(organizationId);
  const organizationInvite = await prisma.organizationInvite.create({ data: { ...pendingInvite, organizationId, email, role: 'MEMBER', tokenHash: `org-${organizationId}` } });
  const eventInvite = await prisma.eventInvite.create({ data: { ...pendingInvite, eventId: event.id, email, role: 'VIEWER', tokenHash: `event-${organizationId}` } });
  return { event, organizationInvite, eventInvite };
};

describe('auth and accounts (integration coverage)', () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await seedTemplates();
  });
  afterAll(() => disconnectTestDatabase());

  describe('the development link', () => {
    const everyLinkFlow = async (accounts: AccountService) => {
      const { organization, owner } = await tenant();
      const event = await eventIn(organization.id);
      await prisma.eventMembership.create({ data: { eventId: event.id, userId: owner.id, role: 'OWNER' } });
      return {
        reset: await accounts.requestPasswordReset(owner.email),
        verify: await accounts.requestEmailVerification(owner.id),
        invite: await accounts.inviteMember(organization.id, owner.id, { email: 'planner@test.local', role: 'MANAGER' }),
        eventInvite: await accounts.inviteToEvent(event.id, owner.id, { email: 'door@test.local', role: 'COORDINATOR' }),
      };
    };

    it.each([['production'], [undefined]])('is absent from every link response when NODE_ENV is %p', async (nodeEnv) => {
      const results = await everyLinkFlow(accountsIn(nodeEnv));

      for (const result of Object.values(results)) expect(result).not.toHaveProperty('devLink');
    });

    it.each([['production'], [undefined]])('still emails each link when NODE_ENV is %p', async (nodeEnv) => {
      await everyLinkFlow(accountsIn(nodeEnv));

      const bodies = (await prisma.message.findMany({ select: { templateKey: true, body: true } }))
        .map(({ templateKey, body }) => [templateKey, body.includes('?token=')]);
      expect(bodies.sort()).toEqual([
        ['account.password-reset', true], ['account.verify-email', true], ['event.invite', true], ['organization.invite', true],
      ]);
    });

    it.each([['development'], ['test']])('is returned with the emailed token when NODE_ENV is %p', async (nodeEnv) => {
      const results = await everyLinkFlow(accountsIn(nodeEnv));

      const messages = await prisma.message.findMany({ select: { body: true } });
      for (const result of Object.values(results)) {
        expect(result.devLink).toMatch(/^https:\/\/aveline\.test\/.+\?token=/);
        expect(messages.some((message) => message.body.includes(new URL(result.devLink ?? '').searchParams.get('token') ?? '-'))).toBe(true);
      }
    });

    it.each([['staging'], ['Production'], ['']])('is absent for an unrecognised NODE_ENV %p', async (nodeEnv) => {
      const { owner } = await tenant();

      const result = await accountsIn(nodeEnv).requestPasswordReset(owner.email);

      expect(result).toEqual({ sent: true });
    });
  });

  describe('leaving or being removed', () => {
    it('revokes the departing person’s pending invitations in this tenant and nowhere else', async () => {
      const { organization, member, ownerActor } = await tenant();
      const here = await inviteRows(organization.id, member.email);
      const elsewhere = await inviteRows((await prisma.organization.create({ data: { name: 'Other' } })).id, member.email);

      await organizations.removeMember(organization.id, ownerActor, { userId: member.id, expectedRevision: 0 });

      expect((await prisma.organizationInvite.findUniqueOrThrow({ where: { id: here.organizationInvite.id } })).revokedAt).not.toBeNull();
      expect((await prisma.eventInvite.findUniqueOrThrow({ where: { id: here.eventInvite.id } })).revokedAt).not.toBeNull();
      expect((await prisma.organizationInvite.findUniqueOrThrow({ where: { id: elsewhere.organizationInvite.id } })).revokedAt).toBeNull();
      expect((await prisma.eventInvite.findUniqueOrThrow({ where: { id: elsewhere.eventInvite.id } })).revokedAt).toBeNull();
    });

    it('leaves other people’s pending invitations in the tenant alone', async () => {
      const { organization, member, ownerActor } = await tenant();
      const someoneElse = await inviteRows(organization.id, 'guest-planner@test.local');

      await organizations.removeMember(organization.id, ownerActor, { userId: member.id, expectedRevision: 0 });

      expect((await prisma.organizationInvite.findUniqueOrThrow({ where: { id: someoneElse.organizationInvite.id } })).revokedAt).toBeNull();
      expect((await prisma.eventInvite.findUniqueOrThrow({ where: { id: someoneElse.eventInvite.id } })).revokedAt).toBeNull();
    });

    it('revokes the pending invitations of a member who leaves of their own accord', async () => {
      const { organization, member, memberActor } = await tenant();
      const here = await inviteRows(organization.id, member.email);

      await organizations.removeMember(organization.id, memberActor, { userId: member.id, expectedRevision: 0 });

      expect((await prisma.eventInvite.findUniqueOrThrow({ where: { id: here.eventInvite.id } })).revokedAt).not.toBeNull();
    });

    it('refuses the sole owner leaving and changes nothing', async () => {
      const { organization, owner, ownerActor } = await tenant();
      const event = await eventIn(organization.id);
      await prisma.eventMembership.create({ data: { eventId: event.id, userId: owner.id, role: 'COORDINATOR' } });
      const own = await inviteRows(organization.id, owner.email);

      await expect(organizations.removeMember(organization.id, ownerActor, { userId: owner.id, expectedRevision: 0 })).rejects.toThrow('handover');

      expect(await prisma.organizationMembership.count({ where: { organizationId: organization.id } })).toBe(2);
      expect(await prisma.eventMembership.count({ where: { userId: owner.id } })).toBe(1);
      expect((await prisma.eventInvite.findUniqueOrThrow({ where: { id: own.eventInvite.id } })).revokedAt).toBeNull();
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).accessRevision).toBe(0);
    });

    it('rolls back the invite revocation when a direct-event owner has not handed over', async () => {
      const { organization, member, ownerActor } = await tenant();
      const here = await inviteRows(organization.id, member.email);
      await prisma.eventMembership.create({ data: { eventId: here.event.id, userId: member.id, role: 'OWNER' } });

      await expect(organizations.removeMember(organization.id, ownerActor, { userId: member.id, expectedRevision: 0 })).rejects.toThrow('handover');

      expect((await prisma.organizationInvite.findUniqueOrThrow({ where: { id: here.organizationInvite.id } })).revokedAt).toBeNull();
      expect((await prisma.eventInvite.findUniqueOrThrow({ where: { id: here.eventInvite.id } })).revokedAt).toBeNull();
    });
  });

  describe('closure reviews', () => {
    const staff = (platformRole: PlatformRole) =>
      prisma.user.create({ data: { email: `${platformRole.toLowerCase()}@aveline.test`, name: platformRole, platformRole } });
    const openReview = async (memberRole: OrganizationRole = 'MEMBER') => {
      const fixture = await tenant(memberRole);
      const review = await reviews.request(fixture.organization.id, fixture.ownerActor, { expectedRevision: 0 });
      const admin = await staff(PlatformRole.ADMIN);
      return { ...fixture, review, adminActor: fixture.actorOf(admin, PlatformRole.ADMIN) };
    };
    const membershipsOf = (organizationId: string) =>
      prisma.organizationMembership.findMany({ where: { organizationId }, select: { userId: true, role: true }, orderBy: { userId: 'asc' } });

    it.each(['MEMBER', 'VIEWER'] as const)('refuses a %s requesting closure and opens no review', async (role) => {
      const { organization, memberActor } = await tenant(role);

      await expect(reviews.request(organization.id, memberActor, { expectedRevision: 0 })).rejects.toMatchObject({ status: 403 });

      expect(await prisma.organizationAccessReview.count()).toBe(0);
    });

    it('refuses SUPPORT resolving a review and leaves the tenant open', async () => {
      const { organization, review, actorOf } = await openReview();
      const support = actorOf(await staff(PlatformRole.SUPPORT), PlatformRole.SUPPORT);

      await expect(reviews.resolve(support, review.reviewId, { decision: 'CLOSE', expectedRevision: 0 })).rejects.toThrow('administrator');

      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).deletedAt).toBeNull();
      expect(await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: review.reviewId } })).toMatchObject({ status: 'OPEN' });
    });

    it('hands over to an active successor and leaves the tenant open', async () => {
      const { organization, owner, member, review, adminActor } = await openReview();

      await expect(reviews.resolve(adminActor, review.reviewId, { decision: 'HANDOVER', successorUserId: member.id, expectedRevision: 0 }))
        .resolves.toMatchObject({ status: 'HANDOVER', accessRevision: 1 });

      expect(await membershipsOf(organization.id)).toEqual(
        [{ userId: owner.id, role: 'OWNER' }, { userId: member.id, role: 'OWNER' }].sort((a, b) => a.userId.localeCompare(b.userId)),
      );
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).deletedAt).toBeNull();
    });

    it('refuses a handover that names no successor and leaves the review open', async () => {
      const { organization, review, adminActor } = await openReview();

      await expect(reviews.resolve(adminActor, review.reviewId, { decision: 'HANDOVER', expectedRevision: 0 })).rejects.toThrow('successor');

      expect(await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: review.reviewId } })).toMatchObject({ status: 'OPEN', revision: 0 });
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).accessRevision).toBe(0);
    });

    it('refuses a handover to a deactivated member and leaves that member’s role alone', async () => {
      const { organization, member, review, adminActor } = await openReview();
      await prisma.user.update({ where: { id: member.id }, data: { isActive: false } });

      await expect(reviews.resolve(adminActor, review.reviewId, { decision: 'HANDOVER', successorUserId: member.id, expectedRevision: 0 })).rejects.toMatchObject({ status: 404 });

      expect(await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: review.reviewId } })).toMatchObject({ status: 'OPEN', revision: 0 });
      expect(await membershipsOf(organization.id)).toContainEqual({ userId: member.id, role: 'MEMBER' });
    });

    it('declines without removing any membership', async () => {
      const { organization, review, adminActor } = await openReview();
      const before = await membershipsOf(organization.id);

      await reviews.resolve(adminActor, review.reviewId, { decision: 'DECLINE', expectedRevision: 0 });

      expect(await membershipsOf(organization.id)).toEqual(before);
      expect(await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: review.reviewId } })).toMatchObject({ status: 'DECLINE' });
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).deletedAt).toBeNull();
    });

    it('refuses resolving a review a second time, at the stale or the current revision', async () => {
      const { organization, review, adminActor } = await openReview();
      await reviews.resolve(adminActor, review.reviewId, { decision: 'DECLINE', expectedRevision: 0 });

      await expect(reviews.resolve(adminActor, review.reviewId, { decision: 'CLOSE', expectedRevision: 0 })).rejects.toMatchObject({ code: 'REVISION_CHANGED' });
      await expect(reviews.resolve(adminActor, review.reviewId, { decision: 'CLOSE', expectedRevision: 1 })).rejects.toThrow('already resolved');

      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).deletedAt).toBeNull();
      expect(await membershipsOf(organization.id)).toHaveLength(2);
    });

    it('closes the tenant, keeping its events and revoking its pending invitations and unfinished exports', async () => {
      const { organization, owner, review, adminActor } = await openReview();
      const pending = await inviteRows(organization.id, 'invitee@test.local');
      const exportJob = await prisma.exportSnapshot.create({ data: {
        eventId: pending.event.id, requestedByUserId: owner.id, idempotencyKey: 'k', kind: 'GUEST_LIST', locale: 'hy', includesContacts: false,
      } });

      await reviews.resolve(adminActor, review.reviewId, { decision: 'CLOSE', expectedRevision: 0 });

      expect(await prisma.event.count({ where: { organizationId: organization.id } })).toBe(1);
      expect((await prisma.organizationInvite.findUniqueOrThrow({ where: { id: pending.organizationInvite.id } })).revokedAt).not.toBeNull();
      expect((await prisma.eventInvite.findUniqueOrThrow({ where: { id: pending.eventInvite.id } })).revokedAt).not.toBeNull();
      expect(await prisma.exportSnapshot.findUniqueOrThrow({ where: { id: exportJob.id } })).toMatchObject({ status: 'FAILED', failureReason: 'ACCESS_REVOKED' });
      expect(await prisma.organizationMembership.count({ where: { organizationId: organization.id } })).toBe(0);
    });

    it('lists open reviews but not resolved ones', async () => {
      const { review, adminActor } = await openReview();
      const other = await prisma.organization.create({ data: { name: 'Other' } });
      const declined = await prisma.organizationAccessReview.create({ data: { organizationId: other.id, reason: 'LAST_OWNER_CLOSURE', status: 'DECLINE' } });

      const listed = await reviews.list(adminActor, { limit: 50 });

      expect(listed.items.map((item) => item.id)).toEqual([review.reviewId]);
      expect(listed.items.map((item) => item.id)).not.toContain(declined.id);
    });
  });
});
