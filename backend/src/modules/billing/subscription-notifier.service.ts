import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MessageChannel, Prisma } from '@prisma/client';
import { appPage } from '../../common/app-url';
import { USED_EMAIL_VERIFICATION } from '../../infra/auth/verified-email';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationsService } from '../communications/communications.service';
import { toMajorUnits } from '../payments/providers/payment-provider';
import { billingLocale, invoiceLinesDisplay } from './billing-display';
import { lockBillingRecipient } from './billing-privacy';

const TEMPLATE_KEY = 'subscription.paid';
const DEDUPE_PREFIX = 'subscription-paid:';
const INVOICE_NOTICE = { id: true, number: true, status: true, requestedByUserId: true,
  paymentNoticeLocale: true, totalMinor: true, currency: true, lines: true, paidAt: true,
  requestedBy: { select: { email: true, isActive: true, deletedAt: true,
    verificationTokens: { where: USED_EMAIL_VERIFICATION, take: 1, select: { id: true } } } } } satisfies Prisma.InvoiceSelect;
type NoticeInvoice = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_NOTICE }>;

function isEligible(invoice: NoticeInvoice | null): invoice is NoticeInvoice & { paymentNoticeLocale: string; requestedBy: NonNullable<NoticeInvoice['requestedBy']>; paidAt: Date } {
  return invoice !== null && invoice.status === 'PAID' && invoice.paidAt !== null &&
    invoice.paymentNoticeLocale !== null && invoice.requestedBy !== null && invoice.requestedBy.isActive &&
    invoice.requestedBy.deletedAt === null && invoice.requestedBy.verificationTokens.length > 0;
}

function descriptionOf(invoice: NoticeInvoice, locale: string): string {
  const lines = invoiceLinesDisplay(invoice.lines, locale);
  if (!Array.isArray(lines)) return '';
  return lines.flatMap((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return [];
    const display = line.display;
    return display && typeof display === 'object' && !Array.isArray(display) && typeof display.description === 'string' ? [display.description] : [];
  }).join('; ');
}

/** A paid invoice is the durable intent. Mail failure never undoes settled money or access. */
@Injectable()
export class SubscriptionNotifierService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionNotifierService.name);
  private sweepCursor: string | null = null;

  constructor(private readonly prisma: PrismaService, private readonly communications: CommunicationsService) {}

  onModuleInit(): void {
    this.communications.checkBeforeSending(TEMPLATE_KEY, (message) => this.isStillWanted(message));
  }

  async sendPaymentConfirmation(invoiceId: string): Promise<boolean> {
    try { return await this.prisma.$transaction((tx) => this.enqueuePayment(tx, invoiceId)); }
    catch { this.logger.warn(`Could not queue subscription payment confirmation for invoice ${invoiceId}`); return false; }
  }

  private async enqueuePayment(tx: Prisma.TransactionClient, invoiceId: string): Promise<boolean> {
    const context = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { requestedByUserId: true } });
    if (!context?.requestedByUserId) return false;
    await lockBillingRecipient(tx, context.requestedByUserId);
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, select: INVOICE_NOTICE });
    if (!isEligible(invoice)) return false;
    const requested = billingLocale(invoice.paymentNoticeLocale);
    const locale = requested === 'fr' ? 'en' : requested;
    await this.communications.enqueueInTransaction(tx, {
      organizationId: null, channel: MessageChannel.EMAIL, templateKey: TEMPLATE_KEY,
      toAddress: invoice.requestedBy.email, locale,
      variables: { number: invoice.number, description: descriptionOf(invoice, locale),
        amount: `${toMajorUnits(invoice.totalMinor, invoice.currency)} ${invoice.currency}`,
        paidAt: invoice.paidAt.toISOString(), link: appPage('/app/billing') },
      dedupeKey: `${DEDUPE_PREFIX}${invoice.id}`,
    });
    return true;
  }

  /** Rotation prevents an invalid recipient or broken template starving later invoices. */
  async sendMissing(limit = 50): Promise<{ queued: number }> {
    const take = Math.max(1, Math.min(limit, 200));
    const invoices = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT i.id FROM invoices i WHERE i.status = 'PAID'
        AND i."requestedByUserId" IS NOT NULL AND i."paymentNoticeLocale" IS NOT NULL
        AND (${this.sweepCursor}::text IS NULL OR i.id > ${this.sweepCursor})
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m."dedupeKey" = 'subscription-paid:' || i.id)
      ORDER BY i.id LIMIT ${take}`;
    this.sweepCursor = invoices.length < take ? null : invoices[invoices.length - 1].id;
    let queued = 0;
    for (const invoice of invoices) if (await this.sendPaymentConfirmation(invoice.id)) queued += 1;
    return { queued };
  }

  private async isStillWanted(message: { id?: string; toAddress: string }): Promise<boolean> {
    if (!message.id) return false;
    const queued = await this.prisma.message.findUnique({ where: { id: message.id }, select: { dedupeKey: true } });
    if (!queued?.dedupeKey?.startsWith(DEDUPE_PREFIX)) return false;
    const invoice = await this.prisma.invoice.findUnique({ where: { id: queued.dedupeKey.slice(DEDUPE_PREFIX.length) }, select: INVOICE_NOTICE });
    return isEligible(invoice) && invoice.requestedBy.email === message.toAddress;
  }
}
