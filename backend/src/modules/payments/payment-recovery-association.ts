import { ConflictException } from '@nestjs/common';
import { Payment, PaymentPurpose, Prisma } from '@prisma/client';

export interface RecoveryAssociation { invoiceId?: string; ticketOrderId?: string }

/** Operator-supplied purchase evidence is checked against immutable financial terms. */
export async function recoveredAssociation(tx: Prisma.TransactionClient, payment: Payment, input: RecoveryAssociation) {
  const invoiceId = input.invoiceId ?? payment.invoiceId;
  const ticketOrderId = input.ticketOrderId ?? payment.ticketOrderId;
  assertAssociation(payment, { invoiceId, ticketOrderId });
  if (payment.purpose === PaymentPurpose.SUBSCRIPTION) {
    await assertInvoice(tx, payment, invoiceId);
  } else if (payment.purpose === PaymentPurpose.TICKET) {
    await assertTicketOrder(tx, payment, ticketOrderId);
  } else if (invoiceId || ticketOrderId) throw new ConflictException('Payment purpose does not support that purchase association');
  return { invoiceId, ticketOrderId };
}

function assertAssociation(payment: Payment, association: { invoiceId: string | null; ticketOrderId: string | null }) {
  if (association.invoiceId && association.ticketOrderId) throw new ConflictException('Payment cannot belong to both invoice and ticket order');
  if ((payment.invoiceId && association.invoiceId !== payment.invoiceId) ||
      (payment.ticketOrderId && association.ticketOrderId !== payment.ticketOrderId)) {
    throw new ConflictException('Existing purchase association cannot be replaced');
  }
}

async function assertInvoice(tx: Prisma.TransactionClient, payment: Payment, invoiceId: string | null) {
  if (!invoiceId) throw new ConflictException('invoiceId: verified purchase association is required');
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assertTerms(payment, { ...invoice, amountMinor: invoice.totalMinor });
}

async function assertTicketOrder(tx: Prisma.TransactionClient, payment: Payment, orderId: string | null) {
  if (!orderId) throw new ConflictException('ticketOrderId: verified purchase association is required');
  const order = await tx.ticketOrder.findUniqueOrThrow({ where: { id: orderId }, include: { event: { select: { organizationId: true } } } });
  assertTerms(payment, { organizationId: order.event.organizationId, amountMinor: order.totalMinor, currency: order.currency });
  if (payment.eventId !== order.eventId) throw new ConflictException('Payment event differs from the verified purchase');
}

function assertTerms(payment: Payment, purchase: { organizationId: string; amountMinor: bigint; currency: string }) {
  if (payment.organizationId !== purchase.organizationId || payment.amountMinor !== purchase.amountMinor || payment.currency !== purchase.currency) {
    throw new ConflictException('Payment does not match the verified purchase');
  }
}
