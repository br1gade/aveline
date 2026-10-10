import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BillingInterval,
  InvoiceStatus,
  PaymentPurpose,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { invoiceNumberFor, periodAfter } from './billing-period';
import { nextInvoiceSequence } from './invoice-number';
import { SubscribeDto } from './dto/subscription.dto';

/** How long a customer has to pay an issued invoice before it is overdue. */
const PAYMENT_TERMS_DAYS = 7;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  /** The price list. Public, because it is the pricing page. */
  async listPlans() {
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
  async current(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });

    return { subscription: subscription === null ? null : describeSubscription(subscription) };
  }

  /**
   * Starts or changes a subscription.
   *
   * A free plan takes effect immediately. A paid one issues an invoice and
   * returns a bank form URL; the subscription stays TRIALING until that
   * payment is confirmed, so access is never granted on an unpaid intent.
   */
  async subscribe(organizationId: string, dto: SubscribeDto) {
    const plan = await this.prisma.plan.findFirst({
      where: { key: dto.planKey, isActive: true },
    });
    if (!plan) throw new NotFoundException(`No plan "${dto.planKey}" is available`);

    const period = periodAfter(plan.interval, new Date());

    if (plan.priceMinor === 0n) {
      const subscription = await this.prisma.$transaction(async (tx) => {
        // Choosing a free plan is choosing not to pay the open invoice.
        await voidOpenInvoices(tx, organizationId);
        return this.upsertSubscription(
          { organizationId, planId: plan.id, period, status: SubscriptionStatus.ACTIVE },
          tx,
        );
      });
      return { subscription: describeSubscription(subscription), invoice: null, payment: null };
    }

    if (!dto.provider) {
      throw new BadRequestException('This plan is paid; choose a provider');
    }

    // The subscription and its invoice are one unit: an invoice with no
    // subscription is a charge for nothing. An existing subscription is left
    // exactly as it is — the invoice carries the plan, applied when paid — so
    // an abandoned change never touches what the customer already has (B39).
    const { subscription, invoice } = await this.prisma.$transaction(async (tx) => {
      // One plan change at a time per organization: two clicks used to read
      // "no open invoice" together and issue two, both payable.
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
      const open = await tx.invoice.findFirst({
        where: { organizationId, planId: plan.id, status: InvoiceStatus.ISSUED },
        include: { subscription: { include: { plan: true } } },
      });
      // The same plan asked for again — a double click, a retry — is the same
      // invoice, and its payment is idempotent by invoice id.
      if (open?.subscription) return { subscription: open.subscription, invoice: open };

      const existing = await tx.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
      const target =
        existing ??
        (await this.upsertSubscription(
          { organizationId, planId: plan.id, period, status: SubscriptionStatus.TRIALING },
          tx,
        ));
      // One open invoice at a time: the newer intent replaces the older.
      await voidOpenInvoices(tx, organizationId);
      const issued = await this.issueInvoice(tx, { organizationId, subscriptionId: target.id, plan });
      return { subscription: target, invoice: issued };
    });

    const payment = await this.payments.start({
      organizationId,
      purpose: PaymentPurpose.SUBSCRIPTION,
      provider: dto.provider,
      amountMinor: invoice.totalMinor.toString(),
      currency: invoice.currency,
      returnUrl: dto.returnUrl ?? 'https://aveline.test/billing/return',
      description: `${plan.name} — invoice ${invoice.number}`,
      // One payment per invoice, whatever the client retries.
      idempotencyKey: `invoice-${invoice.id}`,
    });

    const linked = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { paymentOrderNumber: payment.orderNumber },
    });

    return {
      subscription: describeSubscription(subscription),
      invoice: describeInvoice(linked),
      payment,
    };
  }

  /**
   * Settles the subscription's outstanding invoice after the bank.
   *
   * Idempotent by the same claim-first rule as ticket settlement: the invoice
   * is moved out of ISSUED by a conditional update, so a retried callback or a
   * refreshed return page cannot activate twice or double-count revenue.
   */
  async confirmPayment(organizationId: string, invoiceNumber: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { number: invoiceNumber, organizationId },
    });
    if (!invoice) throw new NotFoundException('No such invoice');
    if (invoice.status === InvoiceStatus.PAID) return describeInvoice(invoice);
    if (!invoice.paymentOrderNumber) {
      throw new BadRequestException('This invoice has no payment to confirm');
    }

    const payment = await this.payments.confirm(invoice.paymentOrderNumber, 'CALLBACK');
    if (payment.status !== 'CAPTURED') {
      return { ...describeInvoice(invoice), payment };
    }

    return this.settleCaptured(invoice);
  }

  /**
   * Settles every invoice whose payment the bank captured — the customers who
   * paid and never came back to the return page, found by reconciliation.
   */
  async settleCapturedInvoices(limit = 50): Promise<{ settled: number }> {
    const invoices = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT i.id FROM invoices i
        JOIN payments p ON p."orderNumber" = i."paymentOrderNumber"
       WHERE i.status IN ('ISSUED', 'VOID') AND p.status = 'CAPTURED'
       ORDER BY i."createdAt" ASC
       LIMIT ${limit}`;

    let settled = 0;
    for (const invoice of invoices) {
      try {
        await this.settleCaptured(invoice);
        settled += 1;
      } catch (error) {
        this.logger.warn(`could not settle invoice ${invoice.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { settled };
  }

  /**
   * A captured payment either pays its invoice or, if the invoice was
   * replaced by a newer one before the money arrived, goes back in full.
   */
  private async settleCaptured(invoice: { id: string }) {
    const current = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    if (current.status !== InvoiceStatus.VOID) return this.markInvoicePaid(current.id);

    const payment = await this.payments.refund(
      current.paymentOrderNumber!,
      current.totalMinor,
      'Paid after the invoice was replaced by a newer plan change',
    );
    return { ...describeInvoice(current), payment };
  }

  /**
   * Pays an invoice and only then applies the plan it was for, with a period
   * starting now. Claim-first, so a retried callback cannot apply it twice.
   */
  async markInvoicePaid(invoiceId: string) {
    const wasSettled = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invoice.updateMany({
        where: { id: invoiceId, status: InvoiceStatus.ISSUED },
        data: { status: InvoiceStatus.PAID, paidAt: new Date() },
      });
      if (claimed.count === 0) return false;

      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { plan: true } });
      if (invoice.subscriptionId) {
        await tx.subscription.update({
          where: { id: invoice.subscriptionId },
          data: { status: SubscriptionStatus.ACTIVE, ...planChange(invoice.plan) },
        });
      }
      return true;
    });

    if (wasSettled) this.logger.log(`invoice ${invoiceId} paid`);
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    return describeInvoice(invoice);
  }

  /**
   * Cancels at the end of the paid period, never immediately.
   *
   * A customer who has paid to the end of the month keeps the month. Cutting
   * access at the click is the behaviour people complain about, and it would
   * mean refunding a part-period we have no way to calculate.
   */
  async cancel(organizationId: string) {
    const subscription = await this.requireSubscription(organizationId);

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
      include: { plan: true },
    });
    return describeSubscription(updated);
  }

  /** Undoing a cancellation before the period ends costs nothing. */
  async resume(organizationId: string) {
    const subscription = await this.requireSubscription(organizationId);
    if (subscription.currentPeriodEnd < new Date()) {
      throw new BadRequestException('This period has already ended; subscribe again');
    }

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false, cancelledAt: null },
      include: { plan: true },
    });
    return describeSubscription(updated);
  }

  async listInvoices(organizationId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return invoices.map((invoice) => describeInvoice(invoice));
  }

  async findInvoice(organizationId: string, number: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { number, organizationId } });
    if (!invoice) throw new NotFoundException('No such invoice');
    return describeInvoice(invoice);
  }

  private async requireSubscription(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({ where: { organizationId } });
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
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
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
      subscriptionId: string;
      plan: { id: string; key: string; name: string; priceMinor: bigint; currency: string; interval: BillingInterval };
    },
  ) {
    const series = String(new Date().getUTCFullYear());
    const sequence = await nextInvoiceSequence(tx, series);

    return tx.invoice.create({
      data: {
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        planId: input.plan.id,
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
    where: { organizationId, status: InvoiceStatus.ISSUED, subscriptionId: { not: null } },
    data: { status: InvoiceStatus.VOID },
  });
}

/** The plan an invoice paid for, starting now; nothing for an invoice with none. */
function planChange(plan: { id: string; interval: BillingInterval } | null): Prisma.SubscriptionUncheckedUpdateInput {
  if (!plan) return {};
  const period = periodAfter(plan.interval, new Date());
  return {
    planId: plan.id,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
  };
}

interface SubscriptionWithPlan {
  id: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  trialEndsAt: Date | null;
  plan: {
    key: string;
    name: string;
    tier: string;
    priceMinor: bigint;
    currency: string;
    interval: BillingInterval;
    features: string[];
    maxEventsPerPeriod: number | null;
    maxGuestsPerEvent: number | null;
    maxLocales: number;
    invitationLifetimeDays: number | null;
  };
}

function describeSubscription(subscription: SubscriptionWithPlan) {
  return {
    status: subscription.status,
    plan: {
      key: subscription.plan.key,
      name: subscription.plan.name,
      tier: subscription.plan.tier,
      priceMinor: subscription.plan.priceMinor.toString(),
      currency: subscription.plan.currency,
      interval: subscription.plan.interval,
    },
    entitlements: {
      maxEventsPerPeriod: subscription.plan.maxEventsPerPeriod,
      maxGuestsPerEvent: subscription.plan.maxGuestsPerEvent,
      maxLocales: subscription.plan.maxLocales,
      invitationLifetimeDays: subscription.plan.invitationLifetimeDays,
      features: subscription.plan.features,
    },
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    cancelledAt: subscription.cancelledAt,
    trialEndsAt: subscription.trialEndsAt,
  };
}

interface InvoiceRow {
  id: string;
  number: string;
  status: InvoiceStatus;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  currency: string;
  lines: Prisma.JsonValue;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  paymentOrderNumber: string | null;
}

function describeInvoice(invoice: InvoiceRow) {
  return {
    number: invoice.number,
    status: invoice.status,
    subtotalMinor: invoice.subtotalMinor.toString(),
    taxMinor: invoice.taxMinor.toString(),
    totalMinor: invoice.totalMinor.toString(),
    currency: invoice.currency,
    lines: invoice.lines,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    paidAt: invoice.paidAt,
    paymentOrderNumber: invoice.paymentOrderNumber,
  };
}
