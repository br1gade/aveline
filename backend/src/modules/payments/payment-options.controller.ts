import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../infra/auth/actor';
import { GUEST_PAGE_LIMITS } from '../../infra/auth/throttler.guard';
import { PaymentGatewayRegistry } from './payment-gateway.registry';

/**
 * Whether anything can be paid for now, and with which banks — for the price
 * list and the host's ticket form, before anyone fills a form (FR-64, FR-109).
 * Not under `payments/`, where the path segment is an order number.
 */
@ApiTags('payments')
@Controller('payment-options')
export class PaymentOptionsController {
  constructor(private readonly gateways: PaymentGatewayRegistry) {}

  @Public()
  @Get()
  // Our renderer reads it for every visitor to the price page, from one address.
  @Throttle(GUEST_PAGE_LIMITS)
  @ApiOperation({ summary: 'Whether payments are on, and the banks a paid order or plan may name' })
  options() {
    return this.gateways.options();
  }
}
