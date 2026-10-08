import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentEventSource,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { assertTransition, isSettled, nextStatusForRefund } from './payment-status';
import { ProviderOutcome, ProviderStatus } from './providers/payment-provider';
import { StartPaymentDto } from './dto/start-payment.dto';

/** How long a registered-but-unpaid order stays payable before expiry. */
const ORDER_LIFETIME_MS = 60 * 60 * 1000;

/** How long a loser of the idempotency race waits for the winner's result. */
const REGISTRATION_WAIT_MS = 50;
const REGISTRATION_WAIT_ATTEMPTS = 40;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGatewayRegistry,
  ) {}

  /**
   * Registers an order with the bank and returns where to send the payer.
   *
   * Idempotent by key: a retried request returns the original payment rather
   * than registering a second order. Networks retry and payers double-tap, so
   * this is the difference between one charge and two.
   */
  async start(dto: StartPaymentDto) {
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return this.describe(existing);

    const gateway = this.gateways.get(dto.provider);
    const orderNumber = `AVL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    const amountMinor = BigInt(dto.amountMinor);

    const claim = await this.claimIdempotencyKey({
        organizationId: dto.organizationId,
        eventId: dto.eventId ?? null,
        purpose: dto.purpose,
        provider: dto.provider,
        orderNumber,
        amountMinor,
        currency: dto.currency,
        returnUrl: dto.returnUrl,
        description: dto.description ?? null,
        idempotencyKey: dto.idempotencyKey,
        expiresAt: new Date(Date.now() + ORDER_LIFETIME_MS),
    });

    // Lost the race to an identical concurrent request. The winner is
    // registering with the bank right now, so wait briefly for its result
    // rather than registering a second order for the same key.
    if (!claim.wasCreated) {
      return this.describe(await this.awaitRegistration(dto.idempotencyKey));
    }

    const payment = claim.payment;

    try {
      const registered = await gateway.registerOrder({
        orderNumber,
        amountMinor,
        currency: dto.currency,
        returnUrl: dto.returnUrl,
        description: dto.description,
        locale: dto.locale,
      });

      return this.describe(
        await this.applyTransition(payment.id, PaymentStatus.PENDING, PaymentEventSource.API, {
          providerRef: registered.providerRef,
          redirectUrl: registered.redirectUrl,
        }),
      );
    } catch (error) {
      await this.applyTransition(payment.id, PaymentStatus.FAILED, PaymentEventSource.API, {
        failureReason: describeError(error),
      });
      throw error;
    }
  }

  /**
   * Inserts the payment, and reports whether this caller is the one that did.
   *
   * The insert IS the claim. The unique constraint on idempotencyKey is what
   * holds under concurrency — a prior read cannot, because two callers can
   * both read nothing. Whoever's insert succeeds owns the right to register
   * with the bank; everyone else must not.
   */
  private async claimIdempotencyKey(data: Prisma.PaymentUncheckedCreateInput) {
    try {
      return { payment: await this.prisma.payment.create({ data }), wasCreated: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const payment = await this.prisma.payment.findUniqueOrThrow({
        where: { idempotencyKey: data.idempotencyKey },
      });
      return { payment, wasCreated: false };
    }
  }

  /**
   * Waits for the caller that won the race to finish registering.
   *
   * Without this a loser would return a payment with no redirect URL, which
   * is useless to a client that has a person waiting on it. Bounded, because
   * a winner that died mid-registration must not hang every retry: the last
   * known state is returned either way.
   */
  private async awaitRegistration(idempotencyKey: string) {
    for (let attempt = 0; attempt < REGISTRATION_WAIT_ATTEMPTS; attempt += 1) {
      const payment = await this.prisma.payment.findUniqueOrThrow({ where: { idempotencyKey } });
      if (payment.status !== PaymentStatus.CREATED) return payment;
      await delay(REGISTRATION_WAIT_MS);
    }

    this.logger.warn(`registration for ${idempotencyKey} did not settle; returning current state`);
    return this.prisma.payment.findUniqueOrThrow({ where: { idempotencyKey } });
  }

  /**
   * Asks the bank what actually happened and records it.
   *
   * This is the ONLY thing that moves a payment to captured. The payer's
   * return redirect is attacker-controlled and proves nothing, so it merely
   * triggers this call.
   */
  async confirm(orderNumber: string, source: PaymentEventSource) {
    const payment = await this.prisma.payment.findUnique({ where: { orderNumber } });
    if (!payment) throw new NotFoundException(`No payment ${orderNumber}`);
    if (isSettled(payment.status) || !payment.providerRef) return this.describe(payment);

    const status = await this.gateways.get(payment.provider).getStatus(payment.providerRef);
    const target = statusFor(status.outcome);
    if (target === payment.status) return this.describe(payment);

    return this.describe(
      await this.applyTransition(payment.id, target, source, {
        raw: status.raw,
        ...extraFieldsFor(status.outcome),
      }),
    );
  }

  /**
   * Refunds all or part of a captured payment.
   *
   * The order of operations is the whole point. We claim the amount in the
   * database FIRST, with a conditional update that can only succeed once,
   * and only then ask the bank to move money.
   *
   * The reverse order — call the bank, then record it — is the obvious
   * reading and is wrong: two concurrent requests both read refundedMinor as
   * zero, both pass the arithmetic check, and both tell the bank to refund.
   * The second database write then fails, so the books show one refund and
   * the bank statement shows two. Money that has left cannot be un-sent.
   *
   * Claiming first inverts which failure is possible: at worst we record a
   * refund the bank then rejects, which reconciliation can see and this
   * method compensates for immediately.
   */
  /**
   * The public refund, for everything except tickets.
   *
   * Ticket payments are refunded only by cancelling their order, which voids
   * the tickets in the same act. Refunding the money alone here would leave a
   * refunded buyer holding valid tickets — money and access disagreeing.
   */
  async refundNonTicket(orderNumber: string, amountMinor: bigint, reason?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { orderNumber },
      select: { purpose: true },
    });
    if (!payment) throw new NotFoundException(`No payment ${orderNumber}`);

    if (payment.purpose === PaymentPurpose.TICKET) {
      throw new BadRequestException(
        'This payment is for tickets. Cancel the ticket order instead, which refunds it and voids its tickets together.',
      );
    }
    return this.refund(orderNumber, amountMinor, reason);
  }

  async refund(orderNumber: string, amountMinor: bigint, reason?: string) {
    const payment = await this.prisma.payment.findUnique({ where: { orderNumber } });
    if (!payment) throw new NotFoundException(`No payment ${orderNumber}`);

    const target = nextStatusForRefund(payment.amountMinor, payment.refundedMinor, amountMinor);
    const refund = await this.claimRefund(payment.id, amountMinor, target, reason);

    try {
      const result = await this.gateways
        .get(payment.provider)
        .refund(payment.providerRef ?? '', amountMinor);

      await this.prisma.$transaction([
        this.prisma.refund.update({
          where: { id: refund.id },
          data: { status: RefundStatus.COMPLETED, completedAt: new Date() },
        }),
        this.prisma.paymentEvent.create({
          data: {
            paymentId: payment.id,
            fromStatus: payment.status,
            toStatus: target,
            source: PaymentEventSource.API,
            payload: toJson(result.raw),
          },
        }),
      ]);
    } catch (error) {
      await this.releaseRefund(payment.id, refund.id, amountMinor, describeError(error));
      throw error;
    }

    return this.describe(
      await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    );
  }

  /**
   * Takes the amount out of the available balance before any money moves.
   *
   * The WHERE clause carries the invariant, so two concurrent claims cannot
   * both succeed: the second finds refundedMinor already increased and
   * matches nothing.
   */
  private async claimRefund(
    paymentId: string,
    amountMinor: bigint,
    target: PaymentStatus,
    reason?: string,
  ) {
    const claimed = await this.prisma.$executeRaw`
      UPDATE "payments"
         SET "refundedMinor" = "refundedMinor" + ${amountMinor},
             "status" = ${target}::"PaymentStatus",
             "updatedAt" = NOW()
       WHERE "id" = ${paymentId}
         AND "status" IN ('CAPTURED', 'PARTIALLY_REFUNDED')
         AND "refundedMinor" + ${amountMinor} <= "amountMinor"
    `;

    if (claimed === 0) {
      throw new ConflictException(
        'Refund no longer fits — the payment was refunded concurrently or is not captured',
      );
    }

    return this.prisma.refund.create({
      data: { paymentId, amountMinor, reason: reason ?? null, status: RefundStatus.PENDING },
    });
  }

  /** Puts a claimed amount back when the bank refuses it. */
  private async releaseRefund(
    paymentId: string,
    refundId: string,
    amountMinor: bigint,
    failureReason: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        UPDATE "payments"
           SET "refundedMinor" = "refundedMinor" - ${amountMinor},
               "status" = CASE WHEN "refundedMinor" - ${amountMinor} = 0
                               THEN 'CAPTURED'::"PaymentStatus"
                               ELSE 'PARTIALLY_REFUNDED'::"PaymentStatus" END,
               "updatedAt" = NOW()
         WHERE "id" = ${paymentId}
      `,
      this.prisma.refund.update({
        where: { id: refundId },
        data: { status: RefundStatus.FAILED, failureReason },
      }),
    ]);

    this.logger.warn(`refund ${refundId} rejected by the provider: ${failureReason}`);
  }

  /**
   * Re-asks the bank about everything unresolved.
   *
   * Callbacks get lost — a redirect the payer abandoned, a webhook that
   * timed out. Without this sweep those become paid customers whose orders
   * never completed, which is the worst failure this system has.
   */
  async reconcile(limit = 50): Promise<{ checked: number; changed: number }> {
    const stale = await this.prisma.payment.findMany({
      where: { status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let changed = 0;
    for (const payment of stale) {
      const before = payment.status;
      const after = await this.reconcileOne(payment);
      if (after !== before) changed += 1;
    }

    return { checked: stale.length, changed };
  }

  async findByOrderNumber(orderNumber: string) {
    const payment = await this.prisma.payment.findUnique({ where: { orderNumber } });
    if (!payment) throw new NotFoundException(`No payment ${orderNumber}`);
    return this.describe(payment);
  }

  private async reconcileOne(payment: { id: string; orderNumber: string; status: PaymentStatus; expiresAt: Date | null }) {
    try {
      if (payment.expiresAt && payment.expiresAt < new Date()) {
        await this.applyTransition(
          payment.id,
          PaymentStatus.EXPIRED,
          PaymentEventSource.RECONCILIATION,
          {},
        );
        return PaymentStatus.EXPIRED;
      }

      const result = await this.confirm(payment.orderNumber, PaymentEventSource.RECONCILIATION);
      return result.status;
    } catch (error) {
      // One unreachable bank must not stop the sweep for every other payment.
      this.logger.warn(`reconciliation failed for ${payment.orderNumber}: ${describeError(error)}`);
      return payment.status;
    }
  }

  /**
   * The single place a payment's status changes. Validates the move, writes
   * the new state and the audit record in one transaction, and guards the
   * write with the expected prior status so two concurrent callbacks cannot
   * both apply.
   */
  private async applyTransition(
    paymentId: string,
    to: PaymentStatus,
    source: PaymentEventSource,
    extra: { raw?: unknown; failureReason?: string; refundedMinor?: bigint; providerRef?: string; redirectUrl?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      assertTransition(current.status, to);

      const updated = await tx.payment.update({
        // Conditioning on the status we read makes this a compare-and-set:
        // a second concurrent callback finds no row and fails loudly.
        where: { id: paymentId, status: current.status },
        data: {
          status: to,
          ...(extra.providerRef ? { providerRef: extra.providerRef } : {}),
          ...(extra.redirectUrl ? { redirectUrl: extra.redirectUrl } : {}),
          ...(extra.failureReason ? { failureReason: extra.failureReason } : {}),
          ...(extra.refundedMinor === undefined ? {} : { refundedMinor: extra.refundedMinor }),
          ...(to === PaymentStatus.AUTHORIZED ? { authorizedAt: new Date() } : {}),
          ...(to === PaymentStatus.CAPTURED ? { capturedAt: new Date() } : {}),
        },
      });

      await tx.paymentEvent.create({
        data: {
          paymentId,
          fromStatus: current.status,
          toStatus: to,
          source,
          payload: toJson(extra.raw),
        },
      });

      return updated;
    });
  }

  /** BigInt is not JSON-serialisable, so amounts cross the wire as strings. */
  private describe(payment: {
    orderNumber: string;
    status: PaymentStatus;
    amountMinor: bigint;
    refundedMinor: bigint;
    currency: string;
    redirectUrl: string | null;
    provider: string;
    failureReason: string | null;
  }) {
    return {
      orderNumber: payment.orderNumber,
      status: payment.status,
      provider: payment.provider,
      amountMinor: payment.amountMinor.toString(),
      refundedMinor: payment.refundedMinor.toString(),
      currency: payment.currency,
      redirectUrl: payment.redirectUrl,
      failureReason: payment.failureReason,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function statusFor(outcome: ProviderOutcome): PaymentStatus {
  switch (outcome.kind) {
    case 'pending':
      return PaymentStatus.PENDING;
    case 'authorized':
      return PaymentStatus.AUTHORIZED;
    case 'captured':
      return PaymentStatus.CAPTURED;
    case 'refunded':
      return PaymentStatus.REFUNDED;
    case 'cancelled':
      return PaymentStatus.CANCELLED;
    case 'failed':
      return PaymentStatus.FAILED;
  }
}

function extraFieldsFor(outcome: ProviderOutcome): { failureReason?: string; refundedMinor?: bigint } {
  if (outcome.kind === 'failed') return { failureReason: outcome.reason };
  if (outcome.kind === 'refunded') return { refundedMinor: outcome.refundedMinor };
  return {};
}

/** Provider payloads are stored verbatim; anything unserialisable is dropped
 *  rather than failing the transition that records it. */
function toJson(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return {};
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return { unserialisable: true };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { ProviderStatus };
