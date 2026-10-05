import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PromoCodesController } from './promo-codes.controller';
import { PromoCodesService } from './promo-codes.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [PaymentsModule],
  controllers: [PromoCodesController, SubscriptionsController],
  providers: [PromoCodesService, SubscriptionsService],
  exports: [PromoCodesService, SubscriptionsService],
})
export class BillingModule {}
