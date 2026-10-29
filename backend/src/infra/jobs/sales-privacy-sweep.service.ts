import { OwnerInviteDeliveryService } from '../../modules/sales/owner-invite-delivery.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnquiryPrivacyService } from '../../modules/sales/enquiry-privacy.service';
import { EnquiryRetentionService } from '../../modules/sales/enquiry-retention.service';
import { Sentry } from '../observability/sentry';
import { SCHEDULES } from './job-lock.service';

@Injectable()
export class SalesPrivacySweepService {
  private readonly logger = new Logger(SalesPrivacySweepService.name);
  constructor(private readonly privacy: EnquiryPrivacyService, private readonly retention: EnquiryRetentionService, private readonly deliveries: OwnerInviteDeliveryService) {}

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  recover(): Promise<void> {
    return Sentry.withMonitor('sales.privacy', async () => {
      // Database batch locks and the process-owned filesystem lock provide
      // correctness across instances; Redis availability cannot pause erasure.
      const work = await Promise.allSettled([this.retention.sweep(), this.deliveries.repair()]);
      const checkpoint = await Promise.allSettled([this.finishPrivacy()]);
      if ([...work, ...checkpoint].some((result) => result.status === 'rejected')) {
        this.logger.error('Intake privacy recovery has failed work; review pending cleanup/checkpoints/deliveries');
        throw new Error('Intake privacy recovery remains pending');
      }
    }, { schedule: { type: 'crontab', value: SCHEDULES.everyMinute }, checkinMargin: 2, maxRuntime: 2 });
  }

  private async finishPrivacy(): Promise<void> {
    await this.privacy.checkpoint();
    await this.privacy.finalizeCheckpointedRequests();
  }
}
