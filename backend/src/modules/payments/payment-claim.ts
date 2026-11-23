import { BadRequestException, ConflictException } from '@nestjs/common';
import { InvoiceStatus, Payment, PaymentPurpose, PaymentStatus, Prisma, TicketOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUniqueViolation } from '../../common/prisma-errors';
import { StartPaymentDto } from './dto/start-payment.dto';

export interface PaymentAssociation { invoiceId?: string; ticketOrderId?: string }
const ORDER_LIFETIME_MS = 60 * 60 * 1000;

export function canRecoverPayment(payment: Pick<Payment, 'status' | 'providerRef' | 'outcomeUnknownAt'>): boolean {
  return Boolean(payment.providerRef) && (payment.status === PaymentStatus.EXPIRED ||
    (payment.status === PaymentStatus.FAILED && payment.outcomeUnknownAt != null));
}

export function canReplacePayment(payment: Pick<Payment, 'status' | 'outcomeUnknownAt' | 'registrationStartedAt' | 'providerRef'>): boolean {
  if (payment.outcomeUnknownAt) return false;
  if (payment.status === PaymentStatus.FAILED || payment.status === PaymentStatus.CANCELLED) return true;
  return payment.status === PaymentStatus.EXPIRED && !payment.providerRef && !payment.registrationStartedAt;
}

/** The purchase, its idempotency claim and its active-attempt pointer commit before bank I/O. */
export async function claimPayment(prisma: PrismaService, dto: StartPaymentDto, association: PaymentAssociation) {
  if (association.invoiceId && association.ticketOrderId) throw new BadRequestException('Payment must belong to one purchase');
  try {
    return await prisma.$transaction(async (tx) => {
      const key = await associatedKey(tx, dto, association);
      const existing = await tx.payment.findUnique({ where: { idempotencyKey: key } });
      if (existing) return { payment: associatedExisting(existing, dto, association), wasCreated: false };
      const payment = await tx.payment.create({ data: paymentData(dto, association, key) });
      if (association.invoiceId) await tx.invoice.update({ where: { id: association.invoiceId }, data: { paymentOrderNumber: payment.orderNumber } });
      if (association.ticketOrderId) await tx.ticketOrder.update({ where: { id: association.ticketOrderId }, data: { paymentOrderNumber: payment.orderNumber } });
      return { payment, wasCreated: true };
    });
  } catch (error) {
    if (!isUniqueViolation(error) || association.invoiceId) throw error;
    const payment = await prisma.payment.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (!payment) throw error;
    return { payment, wasCreated: false };
  }
}

function associatedExisting(payment: Payment, dto: StartPaymentDto, association: PaymentAssociation) {
  if (!association.invoiceId && !association.ticketOrderId) return payment;
  assertPurchase(dto, payment, association.invoiceId ? PaymentPurpose.SUBSCRIPTION : PaymentPurpose.TICKET);
  if (payment.invoiceId !== (association.invoiceId ?? null) || payment.ticketOrderId !== (association.ticketOrderId ?? null)) {
    throw new ConflictException('Payment needs a verified purchase association');
  }
  return payment;
}

async function associatedKey(tx: Prisma.TransactionClient, dto: StartPaymentDto, association: PaymentAssociation): Promise<string> {
  if (association.invoiceId) return invoiceKey(tx, dto, association.invoiceId);
  if (!association.ticketOrderId) return dto.idempotencyKey;
  await tx.$queryRaw`SELECT id FROM ticket_orders WHERE id = ${association.ticketOrderId} FOR UPDATE`;
  const order = await tx.ticketOrder.findUniqueOrThrow({ where: { id: association.ticketOrderId }, include: { event: { select: { organizationId: true } } } });
  assertPurchase(dto, { organizationId: order.event.organizationId, amountMinor: order.totalMinor, currency: order.currency }, PaymentPurpose.TICKET);
  if (dto.eventId !== order.eventId) throw new ConflictException('Payment event does not match its order');
  if (order.paymentOrderNumber) {
    const existing = await tx.payment.findUniqueOrThrow({ where: { orderNumber: order.paymentOrderNumber } });
    return existing.idempotencyKey;
  }
  if (order.status !== TicketOrderStatus.RESERVED) throw new ConflictException('Order no longer holds inventory');
  return dto.idempotencyKey;
}

async function invoiceKey(tx: Prisma.TransactionClient, dto: StartPaymentDto, invoiceId: string): Promise<string> {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${dto.organizationId} FOR UPDATE`;
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assertPurchase(dto, { ...invoice, amountMinor: invoice.totalMinor }, PaymentPurpose.SUBSCRIPTION);
  const captured = await tx.payment.findFirst({ where: { invoiceId, status: { in: [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED] } }, orderBy: { createdAt: 'asc' } });
  if (captured) return captured.idempotencyKey;
  const unresolved = await tx.payment.findFirst({ where: { invoiceId, OR: [
    { outcomeUnknownAt: { not: null } }, { status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
    { status: PaymentStatus.EXPIRED, providerRef: { not: null } },
  ] }, orderBy: { createdAt: 'asc' } });
  if (unresolved) return unresolved.idempotencyKey;
  const previous = invoice.paymentOrderNumber ? await tx.payment.findUnique({ where: { orderNumber: invoice.paymentOrderNumber } }) : null;
  if (previous && !canReplacePayment(previous)) return previous.idempotencyKey;
  if (invoice.status !== InvoiceStatus.ISSUED) throw new ConflictException('Invoice is no longer awaiting payment');
  return previous ? `invoice-${invoice.id}-after-${previous.orderNumber}` : `invoice-${invoice.id}`;
}

function assertPurchase(dto: StartPaymentDto, purchase: { organizationId: string; amountMinor: bigint; currency: string }, purpose: PaymentPurpose): void {
  if (dto.purpose !== purpose || dto.organizationId !== purchase.organizationId || BigInt(dto.amountMinor) !== purchase.amountMinor || dto.currency !== purchase.currency) {
    throw new ConflictException('Payment does not match its purchase');
  }
}

function paymentData(dto: StartPaymentDto, association: PaymentAssociation, key: string): Prisma.PaymentUncheckedCreateInput {
  return { organizationId: dto.organizationId, eventId: dto.eventId ?? null, purpose: dto.purpose,
    provider: dto.provider, orderNumber: `AVL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
    amountMinor: BigInt(dto.amountMinor), currency: dto.currency, returnUrl: dto.returnUrl,
    description: dto.description ?? null, idempotencyKey: key, ...association,
    expiresAt: new Date(Date.now() + ORDER_LIFETIME_MS) };
}
