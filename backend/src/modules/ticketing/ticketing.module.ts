import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PaymentsModule } from '../payments/payments.module';
import { TicketInventoryService } from './ticket-inventory.service';
import { TicketingController } from './ticketing.controller';
import { TicketingService } from './ticketing.service';

@Module({
  imports: [PaymentsModule, BillingModule],
  controllers: [TicketingController],
  providers: [TicketInventoryService, TicketingService],
  exports: [TicketInventoryService, TicketingService],
})
export class TicketingModule {}
