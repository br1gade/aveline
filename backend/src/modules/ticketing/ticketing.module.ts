import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PaymentsModule } from '../payments/payments.module';
import { TicketFulfilmentService } from './ticket-fulfilment.service';
import { TicketInventoryService } from './ticket-inventory.service';
import { TicketNotifierService } from './ticket-notifier.service';
import { TicketingController } from './ticketing.controller';
import { TicketingService } from './ticketing.service';

@Module({
  imports: [PaymentsModule, BillingModule],
  controllers: [TicketingController],
  providers: [
    TicketInventoryService,
    TicketNotifierService,
    TicketFulfilmentService,
    TicketingService,
  ],
  exports: [TicketInventoryService, TicketFulfilmentService, TicketingService],
})
export class TicketingModule {}
