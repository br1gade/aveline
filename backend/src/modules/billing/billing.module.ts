import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PromoCodesController } from './promo-codes.controller';
import { PromoCodesService } from './promo-codes.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionNotifierService } from './subscription-notifier.service';
import { InvoicePagesController } from './invoice-pages.controller';
import { InvoicePagesService } from './invoice-pages.service';

@Module({
  imports: [PaymentsModule],
  controllers: [PromoCodesController, InvoicePagesController, SubscriptionsController],
  providers: [PromoCodesService, SubscriptionsService, SubscriptionNotifierService, InvoicePagesService],
  exports: [PromoCodesService, SubscriptionsService],
})
export class BillingModule {}
