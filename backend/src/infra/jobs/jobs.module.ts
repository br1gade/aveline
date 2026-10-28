import { WhatsAppReceiptSweepService } from './whatsapp-receipt-sweep.service';
import { InvitationMaintenanceSweepService } from './invitation-maintenance-sweep.service';
import { GuestContributionsModule } from '../../modules/guest-contributions/guest-contributions.module';
import { ContributionSweepService } from './contribution-sweep.service';
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
import { EmailFeedbackSweepService } from './email-feedback-sweep.service';
import { JobLockService } from './job-lock.service';
import { JobsService } from './jobs.service';
import { MoneySweepService } from './money-sweep.service';
import { PrivacySweepService } from './privacy-sweep.service';
import { ReminderSweepService } from './reminder-sweep.service';

@Module({
  imports: [GuestContributionsModule, ScheduleModule.forRoot(), PaymentsModule, TicketingModule, BillingModule, InvitationsModule, PrivacyModule, MediaModule],
  providers: [
    InvitationMaintenanceSweepService,
    ContributionSweepService,
    JobLockService,
    JobsService,
    MoneySweepService,
    ReminderSweepService,
    PrivacySweepService,
    ImageSweepService,
    EmailFeedbackSweepService,
    WhatsAppReceiptSweepService,
    HealthWatchService,
  ],
  exports: [JobsService, MoneySweepService, ReminderSweepService, PrivacySweepService, HealthWatchService],
})
export class JobsModule {}
