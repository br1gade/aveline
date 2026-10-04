import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { TicketInventoryService } from './ticket-inventory.service';
import { TicketingController } from './ticketing.controller';
import { TicketingService } from './ticketing.service';

@Module({
  imports: [PaymentsModule],
  controllers: [TicketingController],
  providers: [TicketInventoryService, TicketingService],
  exports: [TicketInventoryService, TicketingService],
})
export class TicketingModule {}
