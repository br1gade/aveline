import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { actorCan } from '../../infra/auth/actor';

/** Work and downloads use current database standing, never roles saved in a job. */
export async function exportAccess(tx: Prisma.TransactionClient, eventId: string, userId: string) {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { organizationId: true } });
  const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true, platformRole: true,
    eventMemberships: { where: { eventId }, select: { role: true } },
    organizationMemberships: { where: { organizationId: event?.organizationId ?? '' }, select: { role: true } },
  } });
  if (!event || !user?.isActive) throw new ForbiddenException('Export permission is no longer available');
  const actor = { userId, email: '', platformRole: user.platformRole, eventRole: user.eventMemberships[0]?.role,
    organizationRole: user.organizationMemberships[0]?.role };
  if (!actorCan(actor, 'operations:read')) throw new ForbiddenException('Export permission is no longer available');
  return { canSeeContacts: actorCan(actor, 'guest:contact:read') };
}
