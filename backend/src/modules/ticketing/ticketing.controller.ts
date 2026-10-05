import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckPromoCodeDto } from '../billing/dto/promo-code.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { TicketingService } from './ticketing.service';
import { Public, RequirePermission } from '../../infra/auth/actor';

@ApiTags('ticketing')
@Controller()
export class TicketingController {
  constructor(private readonly ticketing: TicketingService) {}

  // A stranger buys a ticket without an account.
  @Public()
  @Post('public/events/:slug/orders')
  @ApiOperation({
    summary: 'Reserve tickets and start payment',
    description:
      'Inventory is held before payment, never after — charging for a seat that ' +
      'no longer exists is the worst outcome available. Idempotent by key.',
  })
  createOrder(@Param('slug') slug: string, @Body() dto: CreateOrderDto) {
    return this.ticketing.createOrder(slug, dto);
  }

  @Public()
  @Post('public/events/:slug/promo-check')
  @ApiOperation({
    summary: 'What a promo code is worth on this basket',
    description:
      'A preview, priced from our own ticket prices. The redemption itself is ' +
      'claimed at checkout, so a code can still run out in between.',
  })
  checkPromoCode(@Param('slug') slug: string, @Body() dto: CheckPromoCodeDto) {
    return this.ticketing.checkPromoCode(slug, dto);
  }

  @Public()
  @Get('ticket-orders/:accessToken')
  @ApiOperation({ summary: "A buyer's own order and issued tickets" })
  findOrder(@Param('accessToken') accessToken: string) {
    return this.ticketing.findByAccessToken(accessToken);
  }

  @Public()
  @Post('ticket-orders/:accessToken/confirm')
  @ApiOperation({
    summary: 'Settle an order after the buyer returns from the bank',
    description:
      'Asks the bank server-to-server, then commits inventory and issues ' +
      'tickets. The return redirect alone never issues anything.',
  })
  confirmOrder(@Param('accessToken') accessToken: string) {
    return this.ticketing.confirmOrder(accessToken);
  }

  // Door staff, not the public: possession of a code must not admit itself.
  @RequirePermission('guest:write')
  @Post('tickets/:code/admit')
  @ApiOperation({
    summary: 'Admit a ticket at the door',
    description: 'A code may only be used once; two scanners cannot both admit it.',
  })
  admit(@Param('code') code: string) {
    return this.ticketing.admit(code);
  }

  @RequirePermission('event:write')
  @Post('ticket-orders/release-expired')
  @ApiOperation({
    summary: 'Return inventory held by abandoned checkouts',
    description: 'Without this sweep, abandoned baskets permanently remove seats from sale.',
  })
  releaseExpired() {
    return this.ticketing.releaseExpiredReservations();
  }
}
