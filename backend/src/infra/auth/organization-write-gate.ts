import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Operators may disable writes while in-flight create/join transactions drain. */
export async function canAddOrganizationMembership(tx: Prisma.TransactionClient): Promise<boolean> {
  const [gate] = await tx.$queryRaw<{ minimumRevision: number; multiOrganizationWrites: boolean }[]>`
    SELECT "minimumRevision", "multiOrganizationWrites" FROM runtime_compatibility WHERE id = 'organization-context' FOR SHARE`;
  if (!gate || gate.minimumRevision > 2) throw new ServiceUnavailableException('Organization runtime compatibility is unavailable');
  return gate.multiOrganizationWrites;
}
