import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { TicketingModule } from '../../modules/ticketing/ticketing.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [ScheduleModule.forRoot(), PaymentsModule, TicketingModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
