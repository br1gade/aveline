import { Cron, CronExpression } from '@nestjs/schedule';
import { appPage } from '../../common/app-url';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import {
  BillingInterval,
  InvoiceStatus,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  Plan,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestActor } from '../../infra/auth/actor';
import { requireCurrentOrganizationPermission } from '../../infra/auth/access-locks';
import { PaymentsService } from '../payments/payments.service';
import { assertChargesEnabled } from '../payments/pilot-payments';
import { invoiceNumberFor, periodAfter } from './billing-period';
import { nextInvoiceSequence } from './invoice-number';
import { SubscribeDto } from './dto/subscription.dto';
import { applyScheduledFree, captureFreeTerms, CLEAR_SCHEDULED_FREE, lockBillingOrganization } from './scheduled-free';
import { billingLocale, captureDescriptionTranslations, planDisplay } from './billing-display';
import { describeInvoice, describeSubscription, InvoiceRow, SubscriptionWithPlan } from './billing-presenter';
import { lockBillingRecipient } from './billing-privacy';
import { SubscriptionNotifierService } from './subscription-notifier.service';

/** How long a customer has to pay an issued invoice before it is overdue. */
const PAYMENT_TERMS_DAYS = 7;
const INVOICE_CAPTURE_STATUSES: readonly PaymentStatus[] = [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED];
interface BillingRequest { actor: RequestActor; locale: string }

@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    @Optional() private readonly notifier?: SubscriptionNotifierService,
  ) {}

  onModuleInit(): void {
    this.payments.onRefunded(PaymentPurpose.SUBSCRIPTION, (payment) => this.endRefundedPlan(payment));
  }

  /** The price list. Public, because it is the pricing page. */
  async listPlans(locale = 'en') {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }],
    });

    return plans.map((plan) => ({
      key: plan.key,
      name: plan.name,
      tier: plan.tier,
      priceMinor: plan.priceMinor.toString(),
      currency: plan.currency,
      interval: plan.interval,
      display: planDisplay(plan, locale),
      entitlements: {
        maxEventsPerPeriod: plan.maxEventsPerPeriod,
        maxGuestsPerEvent: plan.maxGuestsPerEvent,
        maxLocales: plan.maxLocales,
        invitationLifetimeDays: plan.invitationLifetimeDays,
        features: plan.features,
      },
    }));
  }

  /**
   * The organization's subscription, wrapped so the response is always an
   * object.
   *
   * Having none is not an error — the account works on whatever the free tier
   * allows — but returning a bare `null` makes Nest send a 200 with an empty
   * body, which every client then has to parse defensively. `{ subscription:
   * null }` is a shape a client can read without a special case.
   */
  async current(organizationId: string, locale = 'en') {
    const load = (db: Prisma.TransactionClient) => db.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
    const existing = await load(this.prisma);
    const subscription = existing?.pendingFreeAt && existing.pendingFreeAt <= new Date()
      ? await this.withBillingLock(organizationId, async (tx) => {
        await applyScheduledFree(tx, organizationId, new Date());
        return load(tx);
      }) : existing;

    return { subscription: subscription === null ? null : describeSubscription(subscription, locale) };
  }

  /**
   * Starts or changes a subscription.
   *
   * Free waits for a current paid period to end. A paid change issues an
   * invoice and leaves the subscription and any scheduled change alone until capture.
   */
  async subscribe(organizationId: string, dto: SubscribeDto, context?: BillingRequest) {
    const locale = context?.locale ?? 'en';
    const plan = await this.prisma.plan.findFirst({
      where: { key: dto.planKey, isActive: true },
    });
    if (!plan) throw new NotFoundException(`No plan "${dto.planKey}" is available`);
    if (plan.priceMinor > 0n) assertChargesEnabled();

    if (plan.priceMinor === 0n) {
      const subscription = await this.selectFreePlan(organizationId, plan, context?.actor);
      return { subscription: describeSubscription(subscription, locale), invoice: null, payment: null };
    }

    if (!dto.provider) {
      throw new BadRequestException('This plan is paid; choose a provider');
    }
    this.payments.assertProviderConfigured(dto.provider);

    // The subscription and its invoice are one unit: an invoice with no
    // subscription is a charge for nothing. An existing subscription is left
    // exactly as it is — the invoice carries the plan, applied when paid — so
    // an abandoned change never touches what the customer already has (B39).
    const { subscription, invoice } = await this.withBillingLock(organizationId, async (tx) => {
      await applyScheduledFree(tx, organizationId, new Date());
      const open = await tx.invoice.findFirst({
        where: { organizationId, planId: plan.id, status: InvoiceStatus.ISSUED },
        include: { subscription: { include: { plan: true } } },
      });
      // The same plan asked for again — a double click, a retry — is the same
      // invoice, and its payment is idempotent by invoice id.
      if (open) return { subscription: open.subscription, invoice: open };

      // A first paid plan opens no subscription until it is paid: a TRIALING
      // row on the paid plan reported its entitlements to an organization that
      // had paid nothing (B85). Paying the invoice creates it.
      const existing = await tx.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
      // One open invoice at a time: the newer intent replaces the older.
      await voidOpenInvoices(tx, organizationId);
      const issued = await this.issueInvoice(tx, { organizationId, subscriptionId: existing?.id ?? null, plan, context });
      return { subscription: existing, invoice: issued };
    }, context?.actor);

    const payment = await this.payInvoice(invoice, {
      organizationId, planName: plan.name, provider: dto.provider, returnUrl: dto.returnUrl,
    });
    const linked = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });

    return {
      subscription: subscription ? describeSubscription(subscription, locale) : null,
      invoice: describeInvoice(linked, locale),
      payment,
    };
  }

  private selectFreePlan(organizationId: string, plan: Plan, actor?: RequestActor) {
    return this.withBillingLock(organizationId, async (tx) => {
      const now = new Date();
      await applyScheduledFree(tx, organizationId, now);
      const current = await tx.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
      if (current?.pendingFreePlanId === plan.id) return current;
      await voidOpenInvoices(tx, organizationId);
      if (!current || !hasPaidPeriod(current, now)) {
        return this.upsertSubscription({
          organizationId, planId: plan.id, period: periodAfter(plan.interval, now), status: SubscriptionStatus.ACTIVE,
        }, tx);
      }
      return tx.subscription.update({
        where: { id: current.id },
        data: {
          pendingFreeAt: current.currentPeriodEnd, pendingFreePlanId: plan.id, pendingFreeTerms: captureFreeTerms(plan),
          cancelAtPeriodEnd: false, cancelledAt: null,
        },
        include: { plan: true },
      });
    }, actor);
  }

  async withdrawFreeChange(organizationId: string, locale = 'en') {
    return this.withBillingLock(organizationId, async (tx) => {
      const subscription = await this.requireSubscription(organizationId, tx);
      if (subscription.pendingFreeAt && subscription.pendingFreeAt <= new Date()) {
        throw new ConflictException('The Free change has already reached its effective date');
      }
      const updated = await tx.subscription.update({
        where: { id: subscription.id }, data: CLEAR_SCHEDULED_FREE, include: { plan: true },
      });
      return describeSubscription(updated, locale);
    });
  }

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async applyDueFreeChanges(now = new Date()) {
    const due = await this.prisma.subscription.findMany({
      where: { pendingFreeAt: { lte: now } }, orderBy: { pendingFreeAt: 'asc' },
      take: 100, select: { organizationId: true },
    });
    for (const { organizationId } of due) {
      try {
        await this.withBillingLock(organizationId, (tx) => applyScheduledFree(tx, organizationId, now));
      } catch {
        this.logger.warn(`Could not apply scheduled Free plan for organization ${organizationId}`);
      }
    }
  }

  private withBillingLock<T>(organizationId: string, work: (tx: Prisma.TransactionClient) => Promise<T>, actor?: RequestActor) {
    return this.prisma.$transaction(async (tx) => {
      await lockBillingOrganization(tx, organizationId);
      if (actor) {
        // Membership writes take organization then account. Erasure only shares
        // the account/invoice locks, and no invoice is written before this lock.
        await lockBillingRecipient(tx, actor.userId);
        await requireCurrentOrganizationPermission(tx, { actor, organizationId, permission: 'billing:write' });
        const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { deletedAt: true } });
        if (!user || user.deletedAt) throw new ForbiddenException('Account is no longer available');
      }
      return work(tx);
    });
  }

  /**
   * Starts — or, for a retry, returns — the payment for an invoice, and links
   * it. The invoice is linked even to an attempt the bank refused, so the next
   * retry knows that attempt is spent.
   */
  private payInvoice(
    invoice: InvoiceRow,
    request: { organizationId: string; planName: string; provider: PaymentProvider; returnUrl?: string },
  ) {
    return this.payments.start({
      organizationId: request.organizationId, purpose: PaymentPurpose.SUBSCRIPTION,
      provider: request.provider, amountMinor: invoice.totalMinor.toString(), currency: invoice.currency,
      returnUrl: request.returnUrl ?? appPage('/billing/return'),
      description: `${request.planName} — invoice ${invoice.number}`, idempotencyKey: `invoice-${invoice.id}`,
    }, { invoiceId: invoice.id });
  }

  /**
   * Settles the subscription's outstanding invoice after the bank.
   *
   * Idempotent by the same claim-first rule as ticket settlement: the invoice
   * is moved out of ISSUED by a conditional update, so a retried callback or a
   * refreshed return page cannot activate twice or double-count revenue.
   */
  async confirmPayment(organizationId: string, invoiceNumber: string, locale = 'en') {
    const invoice = await this.prisma.invoice.findFirst({
      where: { number: invoiceNumber, organizationId },
    });
    if (!invoice) throw new NotFoundException('No such invoice');
    if (invoice.status === InvoiceStatus.PAID) {
      await this.notifier?.sendPaymentConfirmation(invoice.id);
      return describeInvoice(invoice, locale);
    }
    if (!invoice.paymentOrderNumber) {
      throw new BadRequestException('This invoice has no payment to confirm');
    }

    const payment = await this.payments.confirm(invoice.paymentOrderNumber, 'CALLBACK');
    if (!INVOICE_CAPTURE_STATUSES.includes(payment.status)) {
      return { ...describeInvoice(invoice, locale), payment };
    }

    return this.settleCaptured(invoice, invoice.paymentOrderNumber, locale);
  }

  /**
   * Settles every invoice whose payment the bank captured — the customers who
   * paid and never came back to the return page, found by reconciliation.
   */
  async settleCapturedInvoices(limit = 50): Promise<{ settled: number }> {
    const attempts = await this.prisma.$queryRaw<{ id: string; invoiceId: string; orderNumber: string }[]>`
      SELECT p.id, i.id AS "invoiceId", p."orderNumber" FROM payments p
        JOIN invoices i ON p."invoiceId" = i.id
       WHERE p.status IN ('CAPTURED', 'PARTIALLY_REFUNDED') AND p."refundedMinor" < p."amountMinor"
         AND p."outcomeUnknownAt" IS NULL
         AND p.purpose = 'SUBSCRIPTION' AND p."organizationId" = i."organizationId"
         AND p."amountMinor" = i."totalMinor" AND p.currency = i.currency AND
         (i.status IN ('ISSUED', 'VOID') OR (i.status = 'PAID' AND i."paymentOrderNumber" IS DISTINCT FROM p."orderNumber"))
       ORDER BY p."lastCheckedAt" ASC NULLS FIRST, p."createdAt" ASC, p.id ASC
       LIMIT ${limit}`;
    await this.prisma.payment.updateMany({ where: { id: { in: attempts.map((attempt) => attempt.id) } }, data: { lastCheckedAt: new Date() } });
    let settled = 0;
    for (const attempt of attempts) {
      try {
        await this.settleCaptured({ id: attempt.invoiceId }, attempt.orderNumber);
        settled += 1;
      } catch (error) {
        this.logger.warn(`could not settle invoice ${attempt.invoiceId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { settled };
  }

  /** Each captured attempt either wins this invoice once or is refunded on its own reference. */
  private async settleCaptured(invoice: { id: string }, orderNumber: string, locale = 'en') {
    const settled = await this.markInvoicePaid(invoice.id, orderNumber, locale);
    const current = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    if (current.status === InvoiceStatus.PAID && current.paymentOrderNumber === orderNumber) return settled;
    const payment = await this.payments.refundRemaining(orderNumber,
      current.status === InvoiceStatus.VOID ? 'Paid after the invoice was replaced by a newer plan change' : 'Additional capture for an already-paid invoice');
    return { ...describeInvoice(current, locale), payment };
  }

  private async requireInvoiceCapture(tx: Prisma.TransactionClient, invoiceId: string, orderNumber: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM payments WHERE "orderNumber" = ${orderNumber} FOR UPDATE`;
    const [invoice, payment] = await Promise.all([
      tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
      tx.payment.findUnique({ where: { orderNumber } }),
    ]);
    if (!payment || !INVOICE_CAPTURE_STATUSES.includes(payment.status) || payment.refundedMinor >= payment.amountMinor ||
      payment.outcomeUnknownAt || payment.invoiceId !== invoice.id ||
      payment.purpose !== PaymentPurpose.SUBSCRIPTION || payment.organizationId !== invoice.organizationId ||
      payment.amountMinor !== invoice.totalMinor || payment.currency !== invoice.currency) {
      throw new ConflictException('Payment requires an audited invoice association before settlement');
    }
  }

  /**
   * Pays an invoice and only then applies the plan it was for, with a period
   * starting now. Claim-first, so a retried callback cannot apply it twice.
   */
  async markInvoicePaid(invoiceId: string, orderNumber?: string, locale = 'en') {
    const { organizationId } = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { organizationId: true } });
    const wasSettled = await this.withBillingLock(organizationId, async (tx) => {
      if (orderNumber) await this.requireInvoiceCapture(tx, invoiceId, orderNumber);
      const claimed = await tx.invoice.updateMany({
        where: { id: invoiceId, status: InvoiceStatus.ISSUED },
        data: { status: InvoiceStatus.PAID, paidAt: new Date(), paymentOrderNumber: orderNumber },
      });
      if (claimed.count === 0) return false;

      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { plan: true, subscription: true } });
      await this.applyPaidPlan(tx, invoice);
      return true;
    });

    if (wasSettled) this.logger.log(`invoice ${invoiceId} paid`);
    await this.notifier?.sendPaymentConfirmation(invoiceId);
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    return describeInvoice(invoice, locale);
  }

  sendMissingPaymentNotices(limit = 50): Promise<{ queued: number }> {
    return this.notifier?.sendMissing(limit) ?? Promise.resolve({ queued: 0 });
  }

  /**
   * The plan a paid invoice was for, from now. A first plan opens the
   * subscription here, at payment. A cancel made after the invoice was issued
   * stands: paying an older plan change used to quietly undo it (B87).
   */
  private async applyPaidPlan(
    tx: Prisma.TransactionClient,
    invoice: {
      id: string;
      organizationId: string;
      createdAt: Date;
      plan: { id: string; interval: BillingInterval } | null;
      subscription: { id: string; cancelledAt: Date | null } | null;
    },
  ): Promise<void> {
    if (!invoice.subscription) {
      if (!invoice.plan) return;
      const opened = await this.upsertSubscription(
        { organizationId: invoice.organizationId, planId: invoice.plan.id, period: periodAfter(invoice.plan.interval, new Date()), status: SubscriptionStatus.ACTIVE },
        tx,
      );
      await tx.invoice.update({ where: { id: invoice.id }, data: { subscriptionId: opened.id } });
      return;
    }
    const isCancelledSince = invoice.subscription.cancelledAt !== null && invoice.subscription.cancelledAt > invoice.createdAt;
    const change = planChange(invoice.plan);
    await tx.subscription.update({
      where: { id: invoice.subscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        ...change,
        ...(isCancelledSince ? { cancelAtPeriodEnd: true, cancelledAt: invoice.subscription.cancelledAt } : {}),
      },
    });
  }

  /**
   * A subscription payment refunded in full voids its invoice and ends the
   * plan now (decided 10 October 2026, D19) — money back and access kept was
   * the gap. Only for the invoice the current period was bought with: an old
   * invoice refunded later does not end a newer paid period.
   */
  async endRefundedPlan(payment: { orderNumber: string; status: string }): Promise<void> {
    if (payment.status !== 'REFUNDED') return;
    const owner = await this.prisma.invoice.findFirst({
      where: { paymentOrderNumber: payment.orderNumber, status: InvoiceStatus.PAID },
      select: { organizationId: true },
    });
    if (!owner) return;
    await this.withBillingLock(owner.organizationId, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { organizationId: owner.organizationId, paymentOrderNumber: payment.orderNumber, status: InvoiceStatus.PAID },
        select: { id: true, subscriptionId: true, planId: true, paidAt: true, subscription: { select: { planId: true, activeFreeTerms: true } } },
      });
      if (!invoice) return;
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: InvoiceStatus.VOID } });
      if (!invoice.subscriptionId || invoice.subscription?.activeFreeTerms || invoice.subscription?.planId !== invoice.planId) return;

      const newer = await tx.invoice.count({
        where: { subscriptionId: invoice.subscriptionId, status: InvoiceStatus.PAID, paidAt: { gt: invoice.paidAt ?? new Date(0) } },
      });
      if (newer > 0) return;

      const now = new Date();
      await tx.subscription.update({
        where: { id: invoice.subscriptionId },
        data: { status: SubscriptionStatus.CANCELLED, currentPeriodEnd: now, cancelledAt: now, cancelAtPeriodEnd: false },
      });
    });
  }

  /**
   * Cancels at the end of the paid period, never immediately.
   *
   * A customer who has paid to the end of the month keeps the month. Cutting
   * access at the click is the behaviour people complain about, and it would
   * mean refunding a part-period we have no way to calculate.
   */
  async cancel(organizationId: string, locale = 'en') {
    return this.withBillingLock(organizationId, async (tx) => {
      const now = new Date();
      await applyScheduledFree(tx, organizationId, now);
      const subscription = await this.requireSubscription(organizationId, tx);
      const updated = await tx.subscription.update({
        where: { id: subscription.id },
        data: { ...CLEAR_SCHEDULED_FREE, cancelAtPeriodEnd: true, cancelledAt: now },
        include: { plan: true },
      });
      return describeSubscription(updated, locale);
    });
  }

  /** Undoing a cancellation before the period ends costs nothing. */
  async resume(organizationId: string, locale = 'en') {
    return this.withBillingLock(organizationId, async (tx) => {
      const now = new Date();
      await applyScheduledFree(tx, organizationId, now);
      const subscription = await this.requireSubscription(organizationId, tx);
      if (subscription.currentPeriodEnd <= now) {
        throw new BadRequestException('This period has already ended; subscribe again');
      }
      const updated = await tx.subscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: false, cancelledAt: null },
        include: { plan: true },
      });
      return describeSubscription(updated, locale);
    });
  }

  async listInvoices(organizationId: string, locale = 'en') {
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return invoices.map((invoice) => describeInvoice(invoice, locale));
  }

  async findInvoice(organizationId: string, number: string, locale = 'en') {
    const invoice = await this.prisma.invoice.findFirst({ where: { number, organizationId } });
    if (!invoice) throw new NotFoundException('No such invoice');
    return describeInvoice(invoice, locale);
  }

  private async requireSubscription(organizationId: string, tx: Prisma.TransactionClient) {
    const subscription = await tx.subscription.findUnique({ where: { organizationId } });
    if (!subscription) throw new NotFoundException('This organization has no subscription');
    return subscription;
  }

  /** One live subscription per organization, so changing plan updates it. */
  private upsertSubscription(
    input: {
      organizationId: string;
      planId: string;
      period: { start: Date; end: Date };
      status: SubscriptionStatus;
    },
    tx: Prisma.TransactionClient,
  ) {
    const { organizationId, planId, period, status } = input;

    return tx.subscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planId,
        status,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
      },
      update: {
        ...CLEAR_SCHEDULED_FREE,
        activeFreeTerms: Prisma.DbNull,
        planId,
        status,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
      },
      include: { plan: true },
    });
  }

  /**
   * Writes an invoice with the next number in its series.
   *
   * The number comes from a counter row updated in this transaction, so a
   * rolled-back invoice returns its number instead of leaving a gap. Line
   * items are captured here rather than referenced, so a later price change
   * never rewrites a document a customer has already filed.
   */
  private async issueInvoice(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      subscriptionId: string | null;
      plan: Plan;
      context?: BillingRequest;
    },
  ) {
    const series = String(new Date().getUTCFullYear());
    const sequence = await nextInvoiceSequence(tx, series);

    return tx.invoice.create({
      data: {
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        planId: input.plan.id,
        requestedByUserId: input.context?.actor.userId ?? null,
        paymentNoticeLocale: input.context ? billingLocale(input.context.locale) : null,
        number: invoiceNumberFor(series, sequence),
        status: InvoiceStatus.ISSUED,
        subtotalMinor: input.plan.priceMinor,
        // Tax is not computed yet; see docs/GAPS.md. Zero is honest, a
        // guessed rate on a filed document is not.
        taxMinor: 0n,
        totalMinor: input.plan.priceMinor,
        currency: input.plan.currency,
        lines: [
          {
            description: `${input.plan.name} (${input.plan.interval.toLowerCase()})`,
            descriptionTranslations: captureDescriptionTranslations(input.plan),
            planKey: input.plan.key,
            quantity: 1,
            unitPriceMinor: input.plan.priceMinor.toString(),
            totalMinor: input.plan.priceMinor.toString(),
          },
        ],
        issuedAt: new Date(),
        dueAt: new Date(Date.now() + PAYMENT_TERMS_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  }
}

/** Replaces any invoice still waiting for payment: the customer changed their mind. */
async function voidOpenInvoices(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  await tx.invoice.updateMany({
    // Plan invoices only — a first plan's invoice has no subscription yet.
    where: { organizationId, status: InvoiceStatus.ISSUED, planId: { not: null } },
    data: { status: InvoiceStatus.VOID },
  });
}

/** The plan an invoice paid for, starting now; nothing for an invoice with none. */
function planChange(plan: { id: string; interval: BillingInterval } | null): Prisma.SubscriptionUncheckedUpdateInput {
  if (!plan) return {};
  const period = periodAfter(plan.interval, new Date());
  return {
    ...CLEAR_SCHEDULED_FREE,
    activeFreeTerms: Prisma.DbNull,
    planId: plan.id,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
  };
}

function hasPaidPeriod(subscription: SubscriptionWithPlan, now: Date) {
  return subscription.status === SubscriptionStatus.ACTIVE && !subscription.activeFreeTerms &&
    subscription.plan.priceMinor > 0n && subscription.plan.interval !== BillingInterval.PER_EVENT &&
    subscription.currentPeriodEnd > now;
}
