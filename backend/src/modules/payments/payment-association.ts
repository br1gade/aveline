import { Payment, PaymentPurpose } from '@prisma/client';

export function hasMissingPurchase(payment: Pick<Payment, 'purpose' | 'invoiceId' | 'ticketOrderId'>): boolean {
  return (payment.purpose === PaymentPurpose.SUBSCRIPTION && !payment.invoiceId) ||
    (payment.purpose === PaymentPurpose.TICKET && !payment.ticketOrderId);
}
