import { OwnerInviteDeliveryService } from '../../modules/sales/owner-invite-delivery.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnquiryPrivacyService } from '../../modules/sales/enquiry-privacy.service';
import { EnquiryRetentionService } from '../../modules/sales/enquiry-retention.service';
import { JobLockService, SCHEDULES } from './job-lock.service';

@Injectable()
export class SalesPrivacySweepService {
  private readonly logger = new Logger(SalesPrivacySweepService.name);
  constructor(private readonly lock: JobLockService, private readonly privacy: EnquiryPrivacyService, private readonly retention: EnquiryRetentionService, private readonly deliveries: OwnerInviteDeliveryService) {}

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async recover(): Promise<void> {
    await this.lock.runExclusively({ name: 'sales.privacy', ttlSeconds: 55, crontab: SCHEDULES.everyMinute }, async () => {
      await this.retention.sweep();
      await this.deliveries.repair();
      try {
        await this.privacy.checkpoint();
        await this.privacy.finalizeCheckpointedRequests();
      } catch {
        this.logger.error('Protected intake journal checkpoint failed; privacy recovery remains pending');
      }
    });
  }
}
