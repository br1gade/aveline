import { ForbiddenException } from '@nestjs/common';
import { EventRole, OrganizationRole, Prisma } from '@prisma/client';

interface EventCreator {
  userId: string;
  organizationId: string;
}

/** A role in another tenant cannot grant ownership of this new event. */
export async function resolveEventCreatorRole(
  tx: Prisma.TransactionClient,
  input: EventCreator,
): Promise<EventRole> {
  const membership = await tx.organizationMembership.findUnique({
    where: { userId_organizationId: input },
    select: { role: true },
  });
  if (!membership) throw new ForbiddenException('Organization membership is required to create this event');
  return membership.role === OrganizationRole.OWNER ? EventRole.OWNER : EventRole.COORDINATOR;
}
