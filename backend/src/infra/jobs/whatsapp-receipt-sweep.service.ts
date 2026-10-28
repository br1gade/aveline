import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WhatsAppReceiptsService } from '../../modules/communications/whatsapp/whatsapp-receipts.service';
import { JobLockService, SCHEDULES } from './job-lock.service';

@Injectable()
export class WhatsAppReceiptSweepService {
  constructor(private readonly lock: JobLockService, private readonly receipts: WhatsAppReceiptsService) {}

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async reconcileReceipts(): Promise<void> {
    await this.lock.runExclusively({ name: 'whatsapp.receipts', ttlSeconds: 55, crontab: SCHEDULES.everyMinute }, () => this.receipts.reconcile());
  }
}
