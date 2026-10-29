import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Permission } from '../../modules/access/access-policy';
import { RequestActor, actorCan } from './actor';
import { accessDenied, resolveOrganizationContext } from './organization-context';

export async function lockOwnerAddress(tx: Prisma.TransactionClient, normalizedEmail: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${normalizedEmail.trim().toLowerCase()}, 38))::text`;
}

export async function lockOrganizationStanding(tx: Prisma.TransactionClient, input: { organizationId: string; mode?: 'share' | 'update' }): Promise<void> {
  // IDs never change: exclude role-writer SHARE while allowing privacy FK KEY SHARE.
  const lock = input.mode === 'update' ? Prisma.sql`FOR NO KEY UPDATE` : Prisma.sql`FOR SHARE`;
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM organizations WHERE id = ${input.organizationId} AND "deletedAt" IS NULL ${lock}`;
  if (!rows.length) throw accessDenied();
}

export async function lockEventOrganization(tx: Prisma.TransactionClient, eventId: string): Promise<string> {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { organizationId: true } });
  if (!event) throw new NotFoundException('No such event');
  await lockOrganizationStanding(tx, { organizationId: event.organizationId });
  return event.organizationId;
}

export async function lockCurrentUsers(tx: Prisma.TransactionClient, userIds: string[]): Promise<void> {
  if (!userIds.length) return;
  await tx.$queryRaw`SELECT id FROM users WHERE id IN (${Prisma.join([...new Set(userIds)].sort())}) ORDER BY id FOR SHARE`;
}

export async function requireCurrentOrganizationPermission(tx: Prisma.TransactionClient, input: { actor: RequestActor; organizationId: string; permission: Permission }) {
  await lockCurrentUsers(tx, [input.actor.userId]);
  const user = await tx.user.findUnique({ where: { id: input.actor.userId }, select: { isActive: true, platformRole: true } });
  if (!user?.isActive) throw accessDenied();
  const context = await resolveOrganizationContext(tx, { userId: input.actor.userId, platformRole: user.platformRole,
    selector: input.organizationId, mode: 'required', platformPermission: input.permission });
  const current = { ...input.actor, platformRole: user.platformRole, organizationId: input.organizationId, organizationRole: context?.organizationRole, eventRole: null };
  if (!actorCan(current, input.permission)) throw accessDenied();
  return current;
}

export async function requireCurrentEventPermission(tx: Prisma.TransactionClient, input: { actor: Pick<RequestActor, 'userId'>; eventId: string; permission: Permission }) {
  await lockCurrentUsers(tx, [input.actor.userId]);
  const user = await tx.user.findUnique({ where: { id: input.actor.userId }, select: { isActive: true, platformRole: true } });
  if (!user?.isActive) throw new ForbiddenException('Event permission is no longer available');
  const context = await resolveOrganizationContext(tx, { userId: input.actor.userId, platformRole: user.platformRole, eventId: input.eventId, mode: 'event' });
  const member = await tx.eventMembership.findUnique({ where: { userId_eventId: { userId: input.actor.userId, eventId: input.eventId } }, select: { role: true } });
  const actor = { userId: input.actor.userId, email: '', platformRole: user.platformRole, organizationId: context?.organizationId,
    organizationRole: context?.organizationRole, eventRole: member?.role };
  if (!context || !actorCan(actor, input.permission)) throw new ForbiddenException('Event permission is no longer available');
  return actor;
}
