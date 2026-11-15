import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PublicEventsController } from './public-events.controller';
import { PublicEventsService } from './public-events.service';

@Module({
  imports: [PaymentsModule],
  controllers: [PublicEventsController],
  providers: [PublicEventsService],
  exports: [PublicEventsService],
})
export class PublicEventsModule {}
