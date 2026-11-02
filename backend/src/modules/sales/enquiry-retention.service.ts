import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { lockIntake } from './enquiry-lock';
import { redactEnquiries } from './enquiry-privacy';

@Injectable()
export class EnquiryRetentionService {
  private readonly logger = new Logger(EnquiryRetentionService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  clearDue(now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      await lockIntake(tx);
      const due = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_enquiries WHERE stage='CLOSED' AND "cleanupDueAt"<=${now} AND "personalDataClearedAt" IS NULL ORDER BY "cleanupDueAt",id LIMIT 100 FOR UPDATE SKIP LOCKED`;
      if (!due.length || this.config.get<string>('SALES_ENQUIRY_RETENTION_DRY_RUN') === 'true') return { due: due.length, cleared: 0 };
      const contacts = await tx.enquiryContact.findMany({ where: { enquiryId: { in: due.map((row) => row.id) } }, select: { id: true } });
      const result = await redactEnquiries(tx, { contactIds: contacts.map((contact) => contact.id), now, reason: 'RETENTION' });
      return { due: due.length, cleared: result.enquiriesCleared };
    });
  }

  async sweep(now = new Date()) {
    let cleared = 0;
    for (let batch = 0; batch < 5; batch++) {
      const result = await this.clearDue(now);
      cleared += result.cleared;
      if (result.cleared < 100) break;
    }
    const [overdue, uncheckpointed] = await Promise.all([
      this.prisma.salesEnquiry.count({ where: { stage: 'CLOSED', cleanupDueAt: { lte: now }, personalDataClearedAt: null } }),
      this.prisma.enquiryPrivacyRedaction.count({ where: { checkpointedAt: null } }),
    ]);
    if (overdue || uncheckpointed) this.logger.error(`Intake privacy backlog: ${overdue} overdue cases; ${uncheckpointed} uncheckpointed redactions`);
    return { cleared, overdue, uncheckpointed };
  }
}
