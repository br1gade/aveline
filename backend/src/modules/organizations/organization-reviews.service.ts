import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestActor } from '../../infra/auth/actor';
import { lockCurrentUsers, lockOrganizationStanding, requireCurrentOrganizationPermission } from '../../infra/auth/access-locks';
import { assertOrganizationRevision, incrementOrganizationRevision, lockAddressedInvites, lockOrganizationMutation, requireActiveMember, revokeAddressedInvites, revokeOrganizationJobs } from './organization-membership';
import { MembershipPageQuery, OrganizationRevisionDto } from './dto/organization.dto';

@Injectable()
export class OrganizationReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  request(organizationId: string, actor: RequestActor, dto: OrganizationRevisionDto) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganizationMutation(tx, organizationId, dto.expectedRevision);
      await requireCurrentOrganizationPermission(tx, { actor, organizationId, permission: 'member:manage' });
      const membership = await requireActiveMember(tx, organizationId, actor.userId);
      if (membership.role !== 'OWNER') throw new ForbiddenException('Only a current owner may request closure review');
      const review = await tx.organizationAccessReview.upsert({ where: { organizationId }, create: { organizationId, reason: 'LAST_OWNER_CLOSURE' }, update: { status: 'OPEN', reason: 'LAST_OWNER_CLOSURE', revision: { increment: 1 }, resolvedAt: null, resolvedByUserId: null } });
      return { reviewId: review.id, status: review.status, revision: review.revision };
    });
  }

  async list(actor: RequestActor, query: MembershipPageQuery) {
    await this.prisma.$transaction((tx) => requireAdmin(tx, actor));
    // Reviews contain no contacts or financial data; cursor is an opaque row ID.
    return this.prisma.organizationAccessReview.findMany({ where: { status: 'OPEN' }, orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      take: query.limit, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
  }

  async resolve(actor: RequestActor, reviewId: string, input: { decision: 'HANDOVER' | 'CLOSE' | 'DECLINE'; expectedRevision: number; successorUserId?: string }) {
    await this.prisma.$transaction((tx) => requireAdmin(tx, actor));
    const review = await this.prisma.organizationAccessReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('No such review');
    return this.prisma.$transaction(async (tx) => {
      await lockOrganizationStanding(tx, { organizationId: review.organizationId, mode: 'update' });
      await tx.$queryRaw`SELECT id FROM events WHERE "organizationId" = ${review.organizationId} ORDER BY id FOR UPDATE`;
      await lockAddressedInvites(tx, review.organizationId);
      await requireAdmin(tx, actor);
      const current = await tx.organizationAccessReview.findUniqueOrThrow({ where: { id: reviewId } });
      assertOrganizationRevision(current.revision, input.expectedRevision);
      if (current.status !== 'OPEN') throw new ForbiddenException('Review is already resolved');
      await resolveDecision(tx, review.organizationId, input);
      await tx.organizationAccessReview.update({ where: { id: reviewId }, data: { status: input.decision, revision: { increment: 1 }, resolvedAt: new Date(), resolvedByUserId: actor.userId } });
      return { reviewId, status: input.decision, accessRevision: await incrementOrganizationRevision(tx, review.organizationId) };
    }, { timeout: 10_000, maxWait: 5000 });
  }
}

async function requireAdmin(tx: Prisma.TransactionClient, actor: RequestActor): Promise<void> {
  await lockCurrentUsers(tx, [actor.userId]);
  const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { isActive: true, platformRole: true } });
  if (!user?.isActive || user.platformRole !== 'ADMIN') throw new ForbiddenException('Platform administrator review is required');
}
async function resolveDecision(tx: Prisma.TransactionClient, organizationId: string, input: { decision: 'HANDOVER' | 'CLOSE' | 'DECLINE'; successorUserId?: string }): Promise<void> {
  if (input.decision === 'DECLINE') return;
  if (input.decision === 'HANDOVER') {
    if (!input.successorUserId) throw new ForbiddenException('An active successor is required');
    const member = await requireActiveMember(tx, organizationId, input.successorUserId);
    await tx.organizationMembership.update({ where: { id: member.id }, data: { role: 'OWNER' } });
    return;
  }
  await tx.eventMembership.deleteMany({ where: { event: { organizationId } } });
  await tx.organizationMembership.deleteMany({ where: { organizationId } });
  await revokeAddressedInvites(tx, organizationId);
  await revokeOrganizationJobs(tx, organizationId);
  await tx.organization.update({ where: { id: organizationId }, data: { deletedAt: new Date() } });
}

/** Runs after privacy commit; no User-to-organization lock inversion. */
export async function reconcileInactiveOwnerReviews(prisma: PrismaService, userId: string): Promise<void> {
  const memberships = await prisma.organizationMembership.findMany({ where: { userId, role: 'OWNER', organization: { deletedAt: null } }, select: { organizationId: true } });
  // Existing single-membership barrier bounds this until activation review; set-based query finds all missing-owner tenants.
  const ids = memberships.map((membership) => membership.organizationId);
  if (!ids.length) return;
  const organizations = await prisma.organization.findMany({ where: { id: { in: ids }, memberships: { none: { role: 'OWNER', user: { isActive: true } } } }, select: { id: true } });
  await prisma.organizationAccessReview.createMany({ data: organizations.map(({ id }) => ({ organizationId: id, reason: 'INACTIVE_OWNER_RECOVERY' })), skipDuplicates: true });
}
