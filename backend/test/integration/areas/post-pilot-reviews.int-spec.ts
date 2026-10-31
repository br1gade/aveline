import { OrganizationRole, PlatformRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { OrganizationReviewsService } from '../../../src/modules/organizations/organization-reviews.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * organization-reviews.service.ts and
 * docs/post-pilot/ORGANIZATIONS_DESIGN_AND_OPERATIONS.md: an OWNER asks for a
 * closure review and keeps access; an active ADMIN decides HANDOVER, CLOSE or
 * DECLINE once, against the review revision, and the decision leaves evidence.
 */
const prisma = testPrisma();
const reviews = new OrganizationReviewsService(prisma as PrismaService);

async function member(organizationId: string, role: OrganizationRole) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, name: role } });
  await prisma.organizationMembership.create({ data: { organizationId, userId: user.id, role } });
  return { userId: user.id, email: user.email, platformRole: PlatformRole.NONE };
}
async function fixture() {
  const organization = await prisma.organization.create({ data: { name: 'Family' } });
  const [owner, successor] = [await member(organization.id, 'OWNER'), await member(organization.id, 'MEMBER')];
  const admin = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, name: 'Admin', platformRole: 'ADMIN' } });
  return { organizationId: organization.id, owner, successor, admin: { userId: admin.id, email: admin.email, platformRole: PlatformRole.ADMIN } };
}
async function openReview() {
  const state = await fixture();
  const review = await reviews.request(state.organizationId, state.owner, { expectedRevision: 0 });
  return { ...state, reviewId: review.reviewId };
}
const roles = async (organizationId: string) =>
  (prisma.organizationMembership.findMany({ where: { organizationId }, select: { userId: true, role: true }, orderBy: { userId: 'asc' } }));

describe('organization closure reviews (integration coverage)', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);

  describe('requesting', () => {
    it.each(['MANAGER', 'MEMBER'] as const)('refuses a %s request and opens no review', async (role) => {
      const { organizationId } = await fixture();
      const requester = await member(organizationId, role);
      await expect(reviews.request(organizationId, requester, { expectedRevision: 0 })).rejects.toMatchObject({ status: 403 });
      expect(await roles(organizationId)).toContainEqual({ userId: requester.userId, role });
      expect(await prisma.organizationAccessReview.count()).toBe(0);
    });

    it('opens a review for the OWNER while keeping every membership', async () => {
      const { organizationId, owner } = await fixture();
      const before = await roles(organizationId);
      const review = await reviews.request(organizationId, owner, { expectedRevision: 0 });
      expect(review.status).toBe('OPEN');
      expect(await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: review.reviewId } })).toMatchObject({ reason: 'LAST_OWNER_CLOSURE', resolvedAt: null });
      expect(await roles(organizationId)).toEqual(before);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).deletedAt).toBeNull();
    });
  });

  describe('resolving', () => {
    it('revokes pending organization and event invitations on CLOSE', async () => {
      const { organizationId, admin, reviewId } = await openReview();
      const event = await prisma.event.create({ data: { organizationId, title: 'Family', type: 'WEDDING', hostsLabel: 'Family', startsAt: new Date('2027-06-12T15:00:00Z') } });
      const expiresAt = new Date(Date.now() + 86_400_000);
      await prisma.organizationInvite.create({ data: { organizationId, email: 'pending@test.local', role: 'MEMBER', tokenHash: randomUUID(), expiresAt } });
      await prisma.eventInvite.create({ data: { eventId: event.id, email: 'helper@test.local', role: 'COORDINATOR', tokenHash: randomUUID(), expiresAt } });
      await reviews.resolve(admin, reviewId, { decision: 'CLOSE', expectedRevision: 0 });
      expect((await prisma.organizationInvite.findFirstOrThrow()).revokedAt).toBeInstanceOf(Date);
      expect((await prisma.eventInvite.findFirstOrThrow()).revokedAt).toBeInstanceOf(Date);
      expect(await prisma.organizationAccessChange.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ action: 'REVIEW_CLOSE', actorUserId: admin.userId, subjectUserId: null });
    });

    it('refuses HANDOVER without a successor and leaves the review open', async () => {
      const { organizationId, admin, reviewId } = await openReview();
      const before = await roles(organizationId);
      await expect(reviews.resolve(admin, reviewId, { decision: 'HANDOVER', expectedRevision: 0 })).rejects.toMatchObject({ status: 403, message: 'An active successor is required' });
      expect(await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: reviewId } })).toMatchObject({ status: 'OPEN', revision: 0 });
      expect(await roles(organizationId)).toEqual(before);
      expect(await prisma.organizationAccessChange.count()).toBe(0);
    });

    it('refuses HANDOVER to someone who is not an active member', async () => {
      const { admin, reviewId } = await openReview();
      const outsider = await prisma.user.create({ data: { email: 'outsider@test.local', name: 'Outsider' } });
      await expect(reviews.resolve(admin, reviewId, { decision: 'HANDOVER', expectedRevision: 0, successorUserId: outsider.id })).rejects.toMatchObject({ status: 404 });
      expect((await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: reviewId } })).status).toBe('OPEN');
      expect(await prisma.organizationMembership.count({ where: { userId: outsider.id } })).toBe(0);
    });

    it('refuses a deactivated ADMIN and leaves the review open', async () => {
      const { organizationId, admin, reviewId } = await openReview();
      await prisma.user.update({ where: { id: admin.userId }, data: { isActive: false } });
      const before = await roles(organizationId);
      await expect(reviews.resolve(admin, reviewId, { decision: 'CLOSE', expectedRevision: 0 })).rejects.toMatchObject({ status: 403, message: 'Platform administrator review is required' });
      expect(await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: reviewId } })).toMatchObject({ status: 'OPEN', revision: 0 });
      expect(await roles(organizationId)).toEqual(before);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).deletedAt).toBeNull();
    });

    it('promotes the successor to OWNER on HANDOVER and records the evidence', async () => {
      const { organizationId, admin, successor, reviewId } = await openReview();
      const result = await reviews.resolve(admin, reviewId, { decision: 'HANDOVER', expectedRevision: 0, successorUserId: successor.userId });
      expect(result).toMatchObject({ reviewId, status: 'HANDOVER', accessRevision: 1 });
      expect((await prisma.organizationMembership.findFirstOrThrow({ where: { userId: successor.userId } })).role).toBe('OWNER');
      expect(await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: reviewId } })).toMatchObject({ status: 'HANDOVER', revision: 1, resolvedByUserId: admin.userId });
      expect(await prisma.organizationAccessChange.findMany({ select: { action: true, subjectUserId: true, role: true, accessRevision: true } }))
        .toEqual([{ action: 'REVIEW_HANDOVER', subjectUserId: successor.userId, role: 'OWNER', accessRevision: 1 }]);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).deletedAt).toBeNull();
    });

    it('refuses resolving a review that is already resolved', async () => {
      const { admin, successor, reviewId } = await openReview();
      await reviews.resolve(admin, reviewId, { decision: 'HANDOVER', expectedRevision: 0, successorUserId: successor.userId });
      await expect(reviews.resolve(admin, reviewId, { decision: 'CLOSE', expectedRevision: 1 })).rejects.toMatchObject({ status: 403, message: 'Review is already resolved' });
      expect(await prisma.organizationAccessChange.count()).toBe(1);
    });

    it('refuses a stale review revision and changes nothing', async () => {
      const { organizationId, admin, reviewId } = await openReview();
      const before = await roles(organizationId);
      await expect(reviews.resolve(admin, reviewId, { decision: 'CLOSE', expectedRevision: 99 })).rejects.toMatchObject({ status: 409, message: 'expectedRevision: organization revision changed' });
      expect((await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: reviewId } })).status).toBe('OPEN');
      expect(await roles(organizationId)).toEqual(before);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).deletedAt).toBeNull();
    });

    it('changes no membership or standing on DECLINE but records the decision', async () => {
      const { organizationId, admin, reviewId } = await openReview();
      const before = await roles(organizationId);
      await reviews.resolve(admin, reviewId, { decision: 'DECLINE', expectedRevision: 0 });
      expect(await roles(organizationId)).toEqual(before);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).deletedAt).toBeNull();
      expect((await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: reviewId } })).status).toBe('DECLINE');
      expect((await prisma.organizationAccessChange.findFirstOrThrow()).action).toBe('REVIEW_DECLINE');
    });

    it('lets the owner reopen a declined review at the next review revision', async () => {
      const { organizationId, owner, admin, reviewId } = await openReview();
      await reviews.resolve(admin, reviewId, { decision: 'DECLINE', expectedRevision: 0 });
      const reopened = await reviews.request(organizationId, owner, { expectedRevision: 1 });
      expect(reopened).toMatchObject({ reviewId, status: 'OPEN', revision: 2 });
    });

    it('refuses an unknown review with 404', async () => {
      const { admin } = await fixture();
      await expect(reviews.resolve(admin, 'no-such-review', { decision: 'DECLINE', expectedRevision: 0 })).rejects.toMatchObject({ status: 404 });
    });
  });
});
