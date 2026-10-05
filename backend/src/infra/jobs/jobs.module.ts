import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InvitationsModule } from '../../modules/invitations/invitations.module';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { TicketingModule } from '../../modules/ticketing/ticketing.module';
import { HealthWatchService } from '../observability/health-watch.service';
import { JobLockService } from './job-lock.service';
import { JobsService } from './jobs.service';
import { ReminderSweepService } from './reminder-sweep.service';

@Module({
  imports: [ScheduleModule.forRoot(), PaymentsModule, TicketingModule, InvitationsModule],
  providers: [JobLockService, JobsService, ReminderSweepService, HealthWatchService],
  exports: [JobsService, ReminderSweepService, HealthWatchService],
})
export class JobsModule {}
