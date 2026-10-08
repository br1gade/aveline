import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PaymentsModule } from '../payments/payments.module';
import { TicketCancellationService } from './ticket-cancellation.service';
import { TicketFulfilmentService } from './ticket-fulfilment.service';
import { TicketSetupController } from './ticket-setup.controller';
import { TicketSetupService } from './ticket-setup.service';
import { TicketInventoryService } from './ticket-inventory.service';
import { TicketNotifierService } from './ticket-notifier.service';
import { TicketingController } from './ticketing.controller';
import { TicketingService } from './ticketing.service';

@Module({
  imports: [PaymentsModule, BillingModule],
  controllers: [TicketingController, TicketSetupController],
  providers: [
    TicketInventoryService,
    TicketNotifierService,
    TicketFulfilmentService,
    TicketingService,
    TicketSetupService,
    TicketCancellationService,
  ],
  exports: [TicketInventoryService, TicketFulfilmentService, TicketingService],
})
export class TicketingModule {}
