import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function lockIntake(tx: Prisma.TransactionClient, isExclusive = false): Promise<void> {
  await tx.$executeRaw`INSERT INTO enquiry_privacy_fences (id,revision) VALUES ('intake',0) ON CONFLICT DO NOTHING`;
  if (isExclusive) await tx.$queryRaw`SELECT id FROM enquiry_privacy_fences WHERE id='intake' FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM enquiry_privacy_fences WHERE id='intake' FOR SHARE`;
}

export async function lockEnquiry(tx: Prisma.TransactionClient, id: string, isWrite = true) {
  const rows = isWrite
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_enquiries WHERE id=${id} FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_enquiries WHERE id=${id} FOR SHARE`;
  if (!rows.length) throw new NotFoundException('No such enquiry');
  return tx.salesEnquiry.findUniqueOrThrow({ where: { id } });
}
