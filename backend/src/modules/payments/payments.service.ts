import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentEventSource,
  PaymentPurpose,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { assertTransition, isSettled, nextStatusForRefund } from './payment-status';
import { BankDeclinedError, ProviderOutcome, ProviderStatus } from './providers/payment-provider';
import { StartPaymentDto } from './dto/start-payment.dto';
import { FakeBankOutcome } from './dto/fake-bank-answer.dto';
import { FakeGateway } from './providers/fake.gateway';
import { assertChargesEnabled } from './pilot-payments';
import { isRecordNotFound } from '../../common/prisma-errors';
import { canRecoverPayment, claimPayment, PaymentAssociation } from './payment-claim';
import { hasMissingPurchase } from './payment-association';
import { DomainHttpException } from '../../common/domain-http.exception';

/** What the bank reports when it holds the payer's money. */
const MONEY_HELD_STATUSES: readonly PaymentStatus[] = [PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED];

/** Ends we record when no money moved; EXPIRED is our own clock's, never the bank's. */
const ENDED_WITHOUT_MONEY_STATUSES: readonly PaymentStatus[] = [PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.EXPIRED];
const UNKNOWN_REGISTRATION_STATUSES: readonly PaymentStatus[] = [PaymentStatus.CREATED, PaymentStatus.FAILED, PaymentStatus.EXPIRED];
const UNKNOWN_REGISTRATION_MESSAGE = 'Payment registration outcome is unknown. Keep this purchase and confirm with support before trying another payment';

/** How long a loser of the idempotency race waits for the winner's result. */
const REGISTRATION_WAIT_MS = 50;
const REGISTRATION_WAIT_ATTEMPTS = 40;

const FAKE_BANK_ANSWERS: Record<FakeBankOutcome, (fake: FakeGateway, providerRef: string) => void> = {
  PAID: (fake, providerRef) => fake.simulateSuccess(providerRef),
  DECLINED: (fake, providerRef) => fake.simulate(providerRef, { kind: 'failed', reason: 'Declined at the fake bank' }),
};

/** Told after a refund the bank accepted, with the payment as it now stands. */
export type RefundListener = (payment: { orderNumber: string; status: PaymentStatus }) => Promise<unknown>;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly refundListeners = new Map<PaymentPurpose, RefundListener>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGatewayRegistry,
  ) {}

  /**
   * Lets the module that owns a purpose react to its refunds — billing ends a
   * plan whose payment went back in full (D19). A listener rather than a call
   * into billing, because billing depends on payments and not the reverse.
   */
  onRefunded(purpose: PaymentPurpose, listener: RefundListener): void {
    this.refundListeners.set(purpose, listener);
  }

  /** Validate local configuration before a caller commits its financial intent. */
  assertProviderConfigured(provider: PaymentProvider): void {
    this.gateways.get(provider);
  }

  /**
   * Registers an order with the bank and returns where to send the payer.
   *
   * Idempotent by key: a retried request returns the original payment rather
   * than registering a second order. Networks retry and payers double-tap, so
   * this is the difference between one charge and two.
   */
  async start(dto: StartPaymentDto, association: PaymentAssociation = {}) {
    assertChargesEnabled();
    if (!association.invoiceId && !association.ticketOrderId) {
      const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (existing) return this.describe(await this.awaitRegistration(dto.idempotencyKey));
    }
    const gateway = this.gateways.get(dto.provider);
    const claim = await claimPayment(this.prisma, dto, association);
    if (!claim.wasCreated) return this.describe(await this.awaitRegistration(claim.payment.idempotencyKey));
    const payment = claim.payment;
    const marked = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.CREATED, registrationStartedAt: null,
        outcomeUnknownAt: null, expiresAt: { gt: new Date() } },
      data: { registrationStartedAt: new Date() },
    });
    if (marked.count === 0) return this.findByOrderNumber(payment.orderNumber);
    try {
      const registered = await gateway.registerOrder({
        orderNumber: payment.orderNumber, amountMinor: payment.amountMinor, currency: payment.currency,
        returnUrl: payment.returnUrl ?? dto.returnUrl, description: dto.description, locale: dto.locale,
      });
      return this.describe(await this.saveRegistration(payment.id, registered));
    } catch (error) {
      if (error instanceof BankDeclinedError) {
        await this.applyTransition(payment.id, PaymentStatus.FAILED, PaymentEventSource.API, { failureReason: describeError(error) });
        throw error;
      }
      await this.markUnknown(payment.id);
      throw new DomainHttpException('PAYMENT_OUTCOME_UNKNOWN', UNKNOWN_REGISTRATION_MESSAGE);
    }
  }

  /** A storage retry persists the same bank result; it never registers another order. */
  private async saveRegistration(paymentId: string, registered: { providerRef: string; redirectUrl: string }) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
        if (current.providerRef === registered.providerRef) return current;
        return await this.applyTransition(paymentId, PaymentStatus.PENDING, PaymentEventSource.API, registered);
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
    throw new Error('Registration reference could not be stored');
  }

  private async markUnknown(paymentId: string): Promise<void> {
    try {
      await this.prisma.payment.updateMany({ where: { id: paymentId, status: { in: [...UNKNOWN_REGISTRATION_STATUSES] } },
        data: { outcomeUnknownAt: new Date(), failureReason: 'Registration outcome unknown; operator reconciliation required' } });
    } catch {
      // The committed registration marker prevents another attempt even when storage is unavailable.
    }
    this.logger.error(`payment ${paymentId} registration outcome unknown; operator reconciliation required`);
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
    if (hasUnknownRegistration(payment)) throw new DomainHttpException('PAYMENT_OUTCOME_UNKNOWN', UNKNOWN_REGISTRATION_MESSAGE);
    if ((isSettled(payment.status) && !canRecoverPayment(payment)) || !payment.providerRef) return this.describe(payment);

    const status = await this.gateways.get(payment.provider).getStatus(payment.providerRef);
    this.assertBankAmount(payment, status.outcome);
    const target = statusFor(status.outcome);
    if (target === payment.status && !canRecoverPayment(payment)) return this.describe(payment);

    try {
      return this.describe(
        await this.applyTransition(payment.id, target, source, {
          raw: status.raw,
          ...extraFieldsFor(status.outcome),
        }),
      );
    } catch (error) {
      // Another confirmation — the buyer's return page and the sweep, say —
      // recorded the bank's answer first. That is the outcome wanted, not a
      // failure; anything else still is.
      const overtaken = await this.paymentThatOvertook(payment, target, error);
      if (!overtaken) throw error;
      return this.describe(overtaken);
    }
  }

  private assertBankAmount(payment: { id: string; amountMinor: bigint }, outcome: ProviderOutcome): void {
    if ((outcome.kind === 'captured' || outcome.kind === 'authorized') && outcome.amountMinor !== payment.amountMinor) {
      this.logger.error(`payment ${payment.id}: bank amount does not match the purchase; operator reconciliation required`);
      throw new DomainHttpException('PAYMENT_AMOUNT_MISMATCH', 'Bank amount does not match this payment; operator reconciliation required');
    }
  }

  /**
   * The payment as another confirmation left it, if one overtook this one.
   * Committed after our transaction read, the compare-and-set misses; before
   * it, the move we wanted is no longer legal from what it now holds — that
   * second ordering once answered 409 for a payment that was captured. A
   * record that says no money moved while the bank says it did is not being
   * overtaken but a disagreement, and stays a 409 for someone to resolve.
   */
  private async paymentThatOvertook(payment: { id: string; status: PaymentStatus }, target: PaymentStatus, error: unknown) {
    const isMissedWrite = isRecordNotFound(error);
    if (!isMissedWrite && !(error instanceof ConflictException)) return null;
    const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (!isMissedWrite && current.status === payment.status) return null;
    if (MONEY_HELD_STATUSES.includes(target) && ENDED_WITHOUT_MONEY_STATUSES.includes(current.status)) {
      this.logger.error(`bank reports ${current.orderNumber} ${target}, but it was recorded ${current.status} meanwhile`);
      throw new ConflictException(`Cannot move a payment from ${current.status} to ${target}`);
    }
    return current;
  }

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

  /** Compensation may be repeated by several sweep/callback callers, but its bank claim may not. */
  async refundRemaining(orderNumber: string, reason: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { orderNumber } });
    const remaining = payment.amountMinor - payment.refundedMinor;
    if (remaining === 0n) return this.describe(payment);
    try {
      return await this.refund(orderNumber, remaining, reason);
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const current = await this.prisma.payment.findUniqueOrThrow({ where: { orderNumber } });
      if (current.refundedMinor !== current.amountMinor) throw error;
      return this.describe(current);
    }
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
  async refund(orderNumber: string, amountMinor: bigint, reason?: string) {
    const payment = await this.prisma.payment.findUnique({ where: { orderNumber } });
    if (!payment) throw new NotFoundException(`No payment ${orderNumber}`);

    // Checked here for a clear message; the claim below re-checks atomically.
    nextStatusForRefund(payment.amountMinor, payment.refundedMinor, amountMinor);
    const { refund, target } = await this.claimRefund(payment.id, amountMinor, reason);

    let result: ProviderStatus;
    try {
      result = await this.gateways.get(payment.provider).refund(payment.providerRef ?? '', amountMinor, payment.currency);
    } catch (error) {
      await this.settleFailedRefund(payment.id, refund.id, amountMinor, error);
      throw error instanceof BankDeclinedError
        ? error
        : new BadGatewayException('The bank did not answer, so the outcome is unknown. Confirm with the bank before trying the refund again');
    }

    // The bank said yes. A failure from here is ours, and must not release
    // the claim: the money has gone, so the books keep saying so.
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

    const refunded = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    await this.tellRefundListener(refunded);
    return this.describe(refunded);
  }

  /** Logged, never raised: the money has gone back, and that answer must reach the caller. */
  private async tellRefundListener(payment: { purpose: PaymentPurpose; orderNumber: string; status: PaymentStatus }) {
    try {
      await this.refundListeners.get(payment.purpose)?.(payment);
    } catch (error) {
      this.logger.error(`after refunding ${payment.orderNumber}: ${describeError(error)}`);
    }
  }

  /**
   * Takes the amount out of the available balance before any money moves.
   *
   * The WHERE clause carries the invariant, so two concurrent claims cannot
   * both succeed: the second finds refundedMinor already increased and
   * matches nothing.
   */
  private async claimRefund(paymentId: string, amountMinor: bigint, reason?: string) {
    // The status is decided by the same statement that adds the amount, from
    // the row as it is then. Computed from an earlier read, two part refunds
    // completing a payment together each wrote PARTIALLY_REFUNDED. The claim
    // and its Refund row are one transaction: a crash between them once left a
    // payment marked refunded with no record and no money returned.
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ status: PaymentStatus }[]>`
        UPDATE "payments"
           SET "refundedMinor" = "refundedMinor" + ${amountMinor},
               "status" = CASE WHEN "refundedMinor" + ${amountMinor} = "amountMinor"
                               THEN 'REFUNDED'::"PaymentStatus"
                               ELSE 'PARTIALLY_REFUNDED'::"PaymentStatus" END,
               "updatedAt" = NOW()
         WHERE "id" = ${paymentId}
           AND "status" IN ('CAPTURED', 'PARTIALLY_REFUNDED')
           AND "refundedMinor" + ${amountMinor} <= "amountMinor"
     RETURNING "status"
      `;

      if (claimed.length === 0) {
        throw new ConflictException(
          'Refund no longer fits — the payment was refunded concurrently or is not captured',
        );
      }

      const refund = await tx.refund.create({
        data: { paymentId, amountMinor, reason: reason ?? null, status: RefundStatus.PENDING },
      });
      return { refund, target: claimed[0].status };
    });
  }

  /**
   * A refund the bank refused gives its amount back. One whose outcome is
   * unknown keeps it claimed and stays PENDING for someone to confirm with the
   * bank: releasing it, as every failure once did, let the next attempt pay
   * out a second time.
   */
  private async settleFailedRefund(paymentId: string, refundId: string, amountMinor: bigint, error: unknown): Promise<void> {
    if (error instanceof BankDeclinedError) {
      await this.releaseRefund(paymentId, refundId, amountMinor, describeError(error));
      return;
    }
    await this.prisma.refund.update({
      where: { id: refundId },
      data: { failureReason: `Outcome unknown (${describeError(error)}); confirm with the bank` },
    });
    this.logger.error(`refund ${refundId}: outcome unknown — ${describeError(error)}; left claimed for staff to confirm`);
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
    // Longest unasked first: oldest-first let fifty holds the bank kept
    // calling authorised fill every batch, so nothing newer was ever asked.
    // A CREATED row past its lifetime never reached the bank — a crash
    // between the claim and the call — and is swept too, to be expired.
    const stale = await this.prisma.payment.findMany({
      where: {
        OR: [
          { status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
          { status: PaymentStatus.CREATED, expiresAt: { lt: new Date() } },
          { status: PaymentStatus.EXPIRED, providerRef: { not: null } },
          { outcomeUnknownAt: { not: null }, status: { in: [PaymentStatus.CREATED, PaymentStatus.FAILED] } },
        ],
      },
      orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true, orderNumber: true, status: true, expiresAt: true, registrationStartedAt: true, providerRef: true },
    });
    // Stamped before asking, so a sweep that dies part-way does not start
    // with the same batch next time.
    await this.prisma.payment.updateMany({
      where: { id: { in: stale.map((payment) => payment.id) } },
      data: { lastCheckedAt: new Date() },
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

  /**
   * Development only: what a payer would do on the fake bank's page, which
   * does not exist, so a checkout can be finished in a browser. It records
   * nothing — the caller's next confirm reads the answer as from any bank.
   * The fake gateway is registered only in development and test, so
   * elsewhere this is a 404 before any payment is read.
   */
  async answerAsFakeBank(orderNumber: string, outcome: FakeBankOutcome): Promise<void> {
    if (!this.gateways.configured().includes(PaymentProvider.FAKE)) throw new NotFoundException();
    const fake = this.gateways.get(PaymentProvider.FAKE) as FakeGateway;
    const payment = await this.prisma.payment.findUnique({ where: { orderNumber }, select: { provider: true, providerRef: true } });
    if (payment?.provider !== PaymentProvider.FAKE || !payment.providerRef) {
      throw new NotFoundException(`No fake-bank payment ${orderNumber}`);
    }
    FAKE_BANK_ANSWERS[outcome](fake, payment.providerRef);
  }

  /**
   * The bank first, then the clock. Expiring before asking wrote off payments
   * the bank had captured — EXPIRED is final — and the sweep reached a busy
   * hour's real payments only after their lifetime had passed. Only a payment
   * the bank still calls unpaid is expired; an authorised hold is money, and
   * waits for the bank to settle it.
   */
  private async reconcileOne(payment: { id: string; orderNumber: string; status: PaymentStatus; expiresAt: Date | null; registrationStartedAt: Date | null; providerRef: string | null }) {
    try {
      const result = await this.confirm(payment.orderNumber, PaymentEventSource.RECONCILIATION);
      const isOverdue = payment.expiresAt !== null && payment.expiresAt < new Date();
      if (!isOverdue || result.status !== PaymentStatus.CREATED) return result.status;
      if (payment.registrationStartedAt || payment.providerRef) {
        await this.markUnknown(payment.id);
        return result.status;
      }
      return (await this.expireUnstarted(payment.id)).status;
    } catch (error) {
      // One unreachable bank must not stop the sweep for every other payment.
      this.logger.warn(`reconciliation failed for ${payment.orderNumber}: ${describeError(error)}`);
      return payment.status;
    }
  }

  /** Competes with the pre-call marker, so a suspended request cannot register an expired claim. */
  private async expireUnstarted(paymentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({ where: { id: paymentId, status: PaymentStatus.CREATED,
        providerRef: null, registrationStartedAt: null, outcomeUnknownAt: null, expiresAt: { lt: new Date() } },
      data: { status: PaymentStatus.EXPIRED } });
      if (claimed.count > 0) await tx.paymentEvent.create({ data: { paymentId,
        fromStatus: PaymentStatus.CREATED, toStatus: PaymentStatus.EXPIRED, source: PaymentEventSource.RECONCILIATION } });
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    });
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
      const isLateRegistration = Boolean(extra.providerRef && current.registrationStartedAt);
      assertTransition(current.status, to, canRecoverPayment(current) || isLateRegistration);
      const isUnmatchedCapture = to === PaymentStatus.CAPTURED && hasMissingPurchase(current);

      const updated = await tx.payment.update({
        // Conditioning on the status we read makes this a compare-and-set:
        // a second concurrent callback finds no row and fails loudly.
        where: { id: paymentId, status: current.status },
        data: {
          status: to,
          outcomeUnknownAt: isUnmatchedCapture ? new Date() : null,
          failureReason: isUnmatchedCapture ? 'Captured payment needs a verified purchase association' : extra.failureReason ?? null,
          ...bankFields(to, extra),
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
      if (isUnmatchedCapture) this.logger.error(`payment ${paymentId} captured without a verified purchase association; operator recovery required`);
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

function hasUnknownRegistration(payment: { status: PaymentStatus; providerRef: string | null; outcomeUnknownAt: Date | null }): boolean {
  return !payment.providerRef && payment.outcomeUnknownAt != null && UNKNOWN_REGISTRATION_STATUSES.includes(payment.status);
}

function bankFields(to: PaymentStatus, extra: { providerRef?: string; redirectUrl?: string; refundedMinor?: bigint }) {
  return { ...(extra.providerRef ? { providerRef: extra.providerRef } : {}),
    ...(extra.redirectUrl ? { redirectUrl: extra.redirectUrl } : {}),
    ...(extra.refundedMinor === undefined ? {} : { refundedMinor: extra.refundedMinor }),
    ...(to === PaymentStatus.AUTHORIZED ? { authorizedAt: new Date() } : {}),
    ...(to === PaymentStatus.CAPTURED ? { capturedAt: new Date() } : {}) };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
