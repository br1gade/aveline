import { NotFoundException } from '@nestjs/common';
import { OrganizationRole, Prisma } from '@prisma/client';
import { DomainHttpException } from '../../common/domain-http.exception';
import { RequestActor } from '../../infra/auth/actor';
import { lockCurrentUsers, lockOrganizationStanding, requireCurrentOrganizationPermission } from '../../infra/auth/access-locks';
import { accessDenied } from '../../infra/auth/organization-context';

export function assertOrganizationRevision(current: number, expected: number): void {
  if (current !== expected) throw new DomainHttpException('REVISION_CHANGED', 'expectedRevision: organization revision changed');
}
export async function lockOrganizationMutation(tx: Prisma.TransactionClient, organizationId: string, expectedRevision: number) {
  await lockOrganizationStanding(tx, { organizationId, mode: 'update' });
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { accessRevision: true } });
  assertOrganizationRevision(organization.accessRevision, expectedRevision);
  return organization;
}
export async function requireActiveMember(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  await lockCurrentUsers(tx, [userId]);
  const membership = await tx.organizationMembership.findUnique({ where: { userId_organizationId: { userId, organizationId } }, include: { user: { select: { isActive: true } } } });
  if (!membership?.user.isActive) throw new NotFoundException('No active member in this organization');
  return membership;
}
export async function assertOtherOrganizationOwner(tx: Prisma.TransactionClient, organizationId: string, targetUserId: string): Promise<void> {
  const successor = await tx.organizationMembership.findFirst({ where: { organizationId, userId: { not: targetUserId }, role: 'OWNER', user: { isActive: true } }, select: { userId: true } });
  if (!successor) throw ownerHandover();
  await lockCurrentUsers(tx, [successor.userId]);
  const active = await tx.user.findUnique({ where: { id: successor.userId }, select: { isActive: true } });
  if (!active?.isActive) throw ownerHandover();
}
export async function assertEventOwnerSuccessors(tx: Prisma.TransactionClient, organizationId: string, userId: string): Promise<void> {
  const owners = await tx.$queryRaw<{ eventId: string }[]>`
    SELECT target."eventId" FROM event_memberships target JOIN events event ON event.id = target."eventId"
    WHERE event."organizationId" = ${organizationId} AND target."userId" = ${userId} AND target.role = 'OWNER'
    AND NOT EXISTS (SELECT 1 FROM event_memberships other JOIN users successor ON successor.id = other."userId"
      WHERE other."eventId" = target."eventId" AND other."userId" <> ${userId} AND other.role = 'OWNER' AND successor."isActive") LIMIT 1`;
  if (owners.length) throw ownerHandover();
  // Lock viable successors in one bounded-to-tenant set query, then repeat the aggregate.
  await tx.$queryRaw`SELECT id FROM users WHERE "isActive" AND id IN
    (SELECT "userId" FROM event_memberships WHERE role = 'OWNER' AND "userId" <> ${userId}
      AND "eventId" IN (SELECT id FROM events WHERE "organizationId" = ${organizationId})) ORDER BY id FOR SHARE`;
}
export function ownerHandover() { return new DomainHttpException('OWNER_HANDOVER_REQUIRED', 'Ownership handover is required before this change'); }
export async function incrementOrganizationRevision(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  return (await tx.organization.update({ where: { id: organizationId }, data: { accessRevision: { increment: 1 } }, select: { accessRevision: true } })).accessRevision;
}
export async function removeOrganizationAccess(tx: Prisma.TransactionClient, input: { organizationId: string; actor: RequestActor; userId: string; expectedRevision: number }) {
  await lockOrganizationMutation(tx, input.organizationId, input.expectedRevision);
  await tx.$queryRaw`SELECT id FROM events WHERE "organizationId" = ${input.organizationId} AND id IN
    (SELECT "eventId" FROM event_memberships WHERE "userId" = ${input.userId}) ORDER BY id FOR UPDATE`;
  const target = await tx.user.findUnique({ where: { id: input.userId }, select: { email: true } });
  if (!target) throw new NotFoundException('No such member');
  await lockAddressedInvites(tx, input.organizationId, target.email);
  await lockCurrentUsers(tx, [input.actor.userId, input.userId]);
  const membership = await requireActiveMember(tx, input.organizationId, input.userId);
  if (input.actor.userId !== input.userId) await requireCurrentOrganizationPermission(tx, { actor: input.actor, organizationId: input.organizationId, permission: 'member:manage' });
  else if (!membership) throw accessDenied();
  if (membership.role === OrganizationRole.OWNER) await assertOtherOrganizationOwner(tx, input.organizationId, input.userId);
  await assertEventOwnerSuccessors(tx, input.organizationId, input.userId);
  const deleted = await tx.eventMembership.deleteMany({ where: { userId: input.userId, event: { organizationId: input.organizationId } } });
  await tx.organizationMembership.delete({ where: { id: membership.id } });
  await revokeAddressedInvites(tx, input.organizationId, target.email);
  await revokeOrganizationJobs(tx, input.organizationId, input.userId);
  const accessRevision = await incrementOrganizationRevision(tx, input.organizationId);
  return { organizationId: input.organizationId, removedUserId: input.userId, revokedEventRoles: deleted.count, accessRevision };
}
export async function lockAddressedInvites(tx: Prisma.TransactionClient, organizationId: string, email?: string): Promise<void> {
  const address = email ? Prisma.sql`AND email = ${email}` : Prisma.empty;
  await tx.$queryRaw`SELECT id FROM organization_invites WHERE "organizationId" = ${organizationId} ${address} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM event_invites WHERE "eventId" IN (SELECT id FROM events WHERE "organizationId" = ${organizationId}) ${address} ORDER BY id FOR UPDATE`;
}
export async function revokeAddressedInvites(tx: Prisma.TransactionClient, organizationId: string, email?: string): Promise<void> {
  const where = { email, acceptedAt: null, revokedAt: null };
  await tx.organizationInvite.updateMany({ where: { ...where, organizationId }, data: { revokedAt: new Date() } });
  await tx.eventInvite.updateMany({ where: { ...where, event: { organizationId } }, data: { revokedAt: new Date() } });
}
export async function revokeOrganizationJobs(tx: Prisma.TransactionClient, organizationId: string, requestedByUserId?: string): Promise<void> {
  const where = { requestedByUserId, event: { organizationId }, status: { in: ['QUEUED', 'RUNNING'] as ('QUEUED' | 'RUNNING')[] } };
  await tx.seatingJob.updateMany({ where, data: { status: 'FAILED', failureReason: 'ACCESS_REVOKED', leaseOwner: null, leaseUntil: null } });
  await tx.exportSnapshot.updateMany({ where, data: { status: 'FAILED', failureReason: 'ACCESS_REVOKED', revokedAt: new Date(), leaseOwner: null, leaseUntil: null } });
}
