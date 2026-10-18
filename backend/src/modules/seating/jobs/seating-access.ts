import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { actorCan } from '../../../infra/auth/actor';

/** Locked standing cannot be revoked between the apply check and seat commit. */
export async function requireSeatingAccess(tx: Prisma.TransactionClient, eventId: string, userId: string) {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { organizationId: true, status: true } });
  if (!event) throw new ForbiddenException('Seating permission is no longer available');
  if (event.status === 'ARCHIVED') throw new ConflictException('Archived events cannot start or apply automatic seating');
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM event_memberships WHERE "userId" = ${userId} AND "eventId" = ${eventId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM organization_memberships WHERE "userId" = ${userId} AND "organizationId" = ${event.organizationId} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true, platformRole: true,
    eventMemberships: { where: { eventId }, select: { role: true } },
    organizationMemberships: { where: { organizationId: event.organizationId }, select: { role: true } },
  } });
  if (!user?.isActive || !actorCan({ userId, email: '', platformRole: user.platformRole,
    eventRole: user.eventMemberships[0]?.role, organizationRole: user.organizationMemberships[0]?.role }, 'seating:write')) {
    throw new ForbiddenException('Seating permission is no longer available');
  }
}

/** Same exclusive policy fence, without fetching the unused guest-facing venue list. */
export async function lockSeatingEvent(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
  if (!rows.length) throw new NotFoundException('No such event');
}
