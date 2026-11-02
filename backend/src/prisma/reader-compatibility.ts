import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const CURRENT_READER_REVISION = 3;
export interface ReaderCompatibility { minimumRevision: number }

/** The floor covers all shared readers, independently of membership activation. */
export function assertReaderCompatibility(gate: ReaderCompatibility | null | undefined, readerRevision = CURRENT_READER_REVISION): asserts gate is ReaderCompatibility {
  if (!gate || gate.minimumRevision > readerRevision) {
    throw new ServiceUnavailableException('Runtime reader compatibility is unavailable');
  }
}

export async function requireReaderCompatibility(client: Pick<Prisma.TransactionClient, 'runtimeCompatibility'>): Promise<void> {
  const gate = await client.runtimeCompatibility.findUnique({ where: { id: 'organization-context' }, select: { minimumRevision: true } });
  assertReaderCompatibility(gate);
}
