import { Prisma } from '@prisma/client';

/** The notifier and erasure take the same account lock before reading or removing context. */
export async function lockBillingRecipient(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

export async function eraseBillingContext(tx: Prisma.TransactionClient, email: string): Promise<number> {
  const user = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
  if (!user) return 0;
  await lockBillingRecipient(tx, user.id);
  const removed = await tx.invoice.updateMany({ where: { requestedByUserId: user.id }, data: { requestedByUserId: null, paymentNoticeLocale: null } });
  return removed.count;
}

export async function exportBillingContext(tx: Prisma.TransactionClient, email: string) {
  const invoices = await tx.invoice.findMany({
    where: { requestedBy: { email: { equals: email, mode: 'insensitive' } } },
    select: { number: true, status: true, subtotalMinor: true, taxMinor: true, totalMinor: true,
      currency: true, lines: true, issuedAt: true, dueAt: true, paidAt: true, paymentNoticeLocale: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return invoices.map((invoice) => ({ ...invoice, subtotalMinor: invoice.subtotalMinor.toString(),
    taxMinor: invoice.taxMinor.toString(), totalMinor: invoice.totalMinor.toString() }));
}
