import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { USED_EMAIL_VERIFICATION } from '../../infra/auth/verified-email';
import { recoveredAssociation, RecoveryAssociation } from './payment-recovery-association';

export interface PaymentRecovery extends RecoveryAssociation {
  actorUserId: string;
  orderNumber: string;
  action: 'attach-reference' | 'no-registration';
  providerRef?: string;
  reason: string;
  evidenceRef: string;
}

/** The host command records bank evidence; capture/refund still requires ordinary bank confirmation. */
export async function recoverPayment(prisma: PrismaService, input: PaymentRecovery) {
  validateRecovery(input);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.actorUserId} FOR UPDATE`;
    const actor = await tx.user.findFirst({ where: { id: input.actorUserId, isActive: true, platformRole: 'ADMIN',
      verificationTokens: { some: USED_EMAIL_VERIFICATION } }, select: { id: true } });
    if (!actor) throw new ForbiddenException('Recovery requires an active verified administrator');
    await tx.$queryRaw`SELECT id FROM payments WHERE "orderNumber" = ${input.orderNumber} FOR UPDATE`;
    const current = await tx.payment.findUniqueOrThrow({ where: { orderNumber: input.orderNumber } });
    if (!recoverable(current)) throw new ConflictException('Payment is not awaiting registration recovery');
    const association = input.action === 'attach-reference' ? await recoveredAssociation(tx, current, input) : {};
    const data = { ...await recoveryData(tx, current, input), ...association };
    const updated = await tx.payment.update({ where: { id: current.id, status: current.status }, data });
    await tx.paymentEvent.create({ data: { paymentId: current.id, fromStatus: current.status,
      toStatus: updated.status, source: 'MANUAL', payload: { recovery: input.action,
        actorUserId: actor.id, reason: input.reason, evidenceRef: input.evidenceRef } } });
    return { status: updated.status };
  });
}

const RECOVERY_STATUSES: readonly PaymentStatus[] = [PaymentStatus.CREATED, PaymentStatus.FAILED, PaymentStatus.EXPIRED, PaymentStatus.PENDING, PaymentStatus.CAPTURED];
function recoverable(payment: Payment): boolean { return RECOVERY_STATUSES.includes(payment.status) && payment.outcomeUnknownAt !== null; }

async function recoveryData(tx: Prisma.TransactionClient, current: Payment, input: PaymentRecovery): Promise<Prisma.PaymentUncheckedUpdateInput> {
  if (input.action === 'no-registration') {
    if (current.providerRef || current.status === PaymentStatus.CAPTURED) throw new ConflictException('An order with a bank reference needs an authoritative bank status');
    return { status: PaymentStatus.FAILED, outcomeUnknownAt: null, failureReason: 'Bank evidence confirms no payable registration exists' };
  }
  const duplicate = await tx.payment.findFirst({ where: { provider: current.provider, providerRef: input.providerRef, id: { not: current.id } }, select: { id: true } });
  if (duplicate || (current.providerRef && current.providerRef !== input.providerRef)) throw new ConflictException('Bank reference already identifies another attempt');
  const wasCaptured = current.status === PaymentStatus.CAPTURED;
  return { status: wasCaptured ? PaymentStatus.CAPTURED : PaymentStatus.PENDING, providerRef: input.providerRef, lastCheckedAt: null,
    outcomeUnknownAt: wasCaptured ? null : current.outcomeUnknownAt, failureReason: wasCaptured ? null : 'Recovered reference awaits ordinary bank confirmation' };
}

function validateRecovery(input: PaymentRecovery): void {
  for (const [field, value] of Object.entries({ actorUserId: input.actorUserId, orderNumber: input.orderNumber,
    reason: input.reason, evidenceRef: input.evidenceRef })) {
    if (!isEvidenceValue(value)) throw new BadRequestException(`${field}: a bounded evidence value is required`);
  }
  if (!['attach-reference', 'no-registration'].includes(input.action)) throw new BadRequestException('action: choose attach-reference or no-registration');
  validateReference(input);
}

function validateReference(input: PaymentRecovery): void {
  if (input.action === 'attach-reference' && (!input.providerRef || input.providerRef.length > 500 || /\s/.test(input.providerRef))) {
    throw new BadRequestException('providerRef: a bank-verified reference is required');
  }
  if (input.action === 'no-registration' && input.providerRef !== undefined) throw new BadRequestException('providerRef: not accepted for no-registration evidence');
  validateAssociation(input);
}

function validateAssociation(input: RecoveryAssociation): void {
  if (input.invoiceId && input.ticketOrderId) throw new BadRequestException('Choose one purchase association');
  for (const value of [input.invoiceId, input.ticketOrderId]) {
    if (value !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new BadRequestException('Purchase association must be a valid ID');
  }
}

function isEvidenceValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500 && !/[\r\n\0]/.test(value);
}
