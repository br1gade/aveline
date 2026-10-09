import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InvitationsModule } from '../../modules/invitations/invitations.module';
import { BillingModule } from '../../modules/billing/billing.module';
import { MediaModule } from '../../modules/media/media.module';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { PrivacyModule } from '../../modules/privacy/privacy.module';
import { TicketingModule } from '../../modules/ticketing/ticketing.module';
import { HealthWatchService } from '../observability/health-watch.service';
import { ImageSweepService } from './image-sweep.service';
import { JobLockService } from './job-lock.service';
import { JobsService } from './jobs.service';
import { MoneySweepService } from './money-sweep.service';
import { PrivacySweepService } from './privacy-sweep.service';
import { ReminderSweepService } from './reminder-sweep.service';

@Module({
  imports: [ScheduleModule.forRoot(), PaymentsModule, TicketingModule, BillingModule, InvitationsModule, PrivacyModule, MediaModule],
  providers: [
    JobLockService,
    JobsService,
    MoneySweepService,
    ReminderSweepService,
    PrivacySweepService,
    ImageSweepService,
    HealthWatchService,
  ],
  exports: [JobsService, MoneySweepService, ReminderSweepService, PrivacySweepService, HealthWatchService],
})
export class JobsModule {}
