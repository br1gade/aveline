import { BadRequestException, Injectable } from '@nestjs/common';
import { EmailFeedback, EmailFeedbackOutcome, MessageStatus, Prisma, SuppressionReason } from '@prisma/client';
import { isUsableEmailAddress } from '../../common/address';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailFeedbackDto } from './dto/email-feedback.dto';
import { SuppressionService } from './suppression.service';

type FeedbackMessage = Prisma.MessageGetPayload<{ select: typeof FEEDBACK_MESSAGE }>;
const FEEDBACK_MESSAGE = { id: true, channel: true, toAddress: true, status: true, failureReason: true } satisfies Prisma.MessageSelect;
const SENT_STATES: MessageStatus[] = ['SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED'];
const COMPLAINT_REASON = 'Email complaint reported';

@Injectable()
export class EmailFeedbackService {
  constructor(private readonly prisma: PrismaService, private readonly suppressions: SuppressionService) {}

  async receive(dto: EmailFeedbackDto): Promise<{ accepted: true }> {
    const occurredAt = new Date(dto.occurredAt);
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 300000) {
      throw new BadRequestException('occurredAt must be a valid time, not more than five minutes in the future');
    }
    await this.prisma.emailFeedback.createMany({ data: { ...dto, occurredAt }, skipDuplicates: true });
    await this.apply(dto.receiptKey);
    return { accepted: true };
  }

  async reconcile(): Promise<void> {
    const now = Date.now();
    await this.prisma.emailFeedback.deleteMany({ where: { processedAt: null, receivedAt: { lt: new Date(now - 7 * 86400000) } } });
    await this.prisma.emailFeedback.deleteMany({ where: { processedAt: { lt: new Date(now - 30 * 86400000) } } });
    const pending = await this.prisma.emailFeedback.findMany({ where: { processedAt: null }, orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { receivedAt: 'asc' }], take: 50, select: { receiptKey: true } });
    // Bounded to fifty receipts; each transaction owns its receipt/message.
    for (let start = 0; start < pending.length; start += 5) {
      await Promise.all(pending.slice(start, start + 5).map((row) => this.apply(row.receiptKey)));
    }
  }

  private async apply(receiptKey: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "receiptKey" FROM email_feedback WHERE "receiptKey" = ${receiptKey} FOR UPDATE`;
      const receipt = await tx.emailFeedback.findUnique({ where: { receiptKey } });
      if (!receipt || receipt.processedAt) return;
      await tx.emailFeedback.update({ where: { receiptKey }, data: { lastCheckedAt: new Date() } });
      await tx.$queryRaw`SELECT id FROM messages WHERE id = ${receipt.messageId} FOR UPDATE`;
      const message = await tx.message.findUnique({ where: { id: receipt.messageId }, select: FEEDBACK_MESSAGE });
      if (!message || message.status === MessageStatus.QUEUED) return;
      if (message.channel === 'EMAIL' && isUsableEmailAddress(message.toAddress) && SENT_STATES.includes(message.status)) {
        await this.applyOutcome(tx, message, receipt);
      }
      await tx.emailFeedback.update({ where: { receiptKey }, data: { processedAt: new Date() } });
    });
  }

  private async applyOutcome(tx: Prisma.TransactionClient, message: FeedbackMessage, receipt: EmailFeedback): Promise<void> {
    if (receipt.outcome === EmailFeedbackOutcome.DELIVERED) {
      await tx.message.updateMany({ where: { id: message.id, status: { in: ['SENDING', 'SENT'] } }, data: { status: 'DELIVERED', deliveredAt: receipt.occurredAt, failureReason: null } });
      return;
    }
    if (receipt.outcome === EmailFeedbackOutcome.SOFT_BOUNCE) {
      await tx.message.updateMany({ where: { id: message.id, status: { in: ['SENDING', 'SENT'] } }, data: { failureReason: 'Temporary email bounce reported' } });
      return;
    }
    const isComplaint = receipt.outcome === EmailFeedbackOutcome.COMPLAINT;
    if (isComplaint || message.failureReason !== COMPLAINT_REASON) {
      await tx.message.update({ where: { id: message.id }, data: { status: isComplaint ? 'FAILED' : 'BOUNCED', failureReason: isComplaint ? COMPLAINT_REASON : 'Permanent email bounce reported' } });
    }
    await this.suppressions.suppress({ organizationId: null, channel: 'EMAIL', address: message.toAddress, reason: isComplaint ? SuppressionReason.COMPLAINT : SuppressionReason.HARD_BOUNCE }, tx);
  }
}
