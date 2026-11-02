import { Prisma } from '@prisma/client';
import { assertReaderCompatibility } from '../../prisma/reader-compatibility';

/** Operators may disable writes while in-flight create/join transactions drain. */
export async function canAddOrganizationMembership(tx: Prisma.TransactionClient): Promise<boolean> {
  const [gate] = await tx.$queryRaw<{ minimumRevision: number; multiOrganizationWrites: boolean }[]>`
    SELECT "minimumRevision", "multiOrganizationWrites" FROM runtime_compatibility WHERE id = 'organization-context' FOR SHARE`;
  assertReaderCompatibility(gate);
  return gate.multiOrganizationWrites;
}
