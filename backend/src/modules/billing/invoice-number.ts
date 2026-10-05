import { Prisma } from '@prisma/client';

/**
 * Takes the next number in a series.
 *
 * One statement: the insert seeds the series, the conflict branch increments
 * it, and either way the row is locked until this transaction commits — so two
 * concurrent issuers cannot be handed the same number.
 */
export async function nextInvoiceSequence(tx: Prisma.TransactionClient, series: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ sequence: number }[]>`
    INSERT INTO "invoice_counters" ("series", "next", "updatedAt")
         VALUES (${series}, 2, NOW())
    ON CONFLICT ("series")
      DO UPDATE SET "next" = "invoice_counters"."next" + 1, "updatedAt" = NOW()
      RETURNING "next" - 1 AS "sequence"
  `;
  return row.sequence;
}
