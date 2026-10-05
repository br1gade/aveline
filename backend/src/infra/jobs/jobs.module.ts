import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { TicketingModule } from '../../modules/ticketing/ticketing.module';
import { JobsService } from './jobs.service';
import { HealthWatchService } from '../observability/health-watch.service';

@Module({
  imports: [ScheduleModule.forRoot(), PaymentsModule, TicketingModule],
  providers: [JobsService, HealthWatchService],
  exports: [JobsService, HealthWatchService],
})
export class JobsModule {}
