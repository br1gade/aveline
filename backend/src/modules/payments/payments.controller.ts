import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PaymentEventSource } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StartPaymentDto } from './dto/start-payment.dto';
import { PaymentsService } from './payments.service';
import { Public, RequirePermission } from '../../infra/auth/actor';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // Started by a buyer during checkout, so no session exists yet. The
  // throttle is what protects it.
  @Public()
  @Post()
  @ApiOperation({
    summary: 'Register an order and get the bank form URL to redirect the payer to',
    description: 'Idempotent by idempotencyKey — a retry returns the original payment.',
  })
  start(@Body() dto: StartPaymentDto) {
    return this.payments.start(dto);
  }

  @Public()
  @Get(':orderNumber')
  @ApiOperation({ summary: 'Current state of a payment' })
  find(@Param('orderNumber') orderNumber: string) {
    return this.payments.findByOrderNumber(orderNumber);
  }

  @Public()
  @Post(':orderNumber/confirm')
  @ApiOperation({
    summary: 'Ask the bank what happened and record it',
    description:
      'Called after the payer returns. The return redirect is attacker-controlled ' +
      'and proves nothing; this server-to-server check is what decides the outcome.',
  })
  confirm(@Param('orderNumber') orderNumber: string, @Query('source') source?: string) {
    return this.payments.confirm(
      orderNumber,
      source === 'callback' ? PaymentEventSource.CALLBACK : PaymentEventSource.API,
    );
  }

  @RequirePermission('billing:read')
  @Post(':orderNumber/refund')
  @ApiOperation({ summary: 'Refund all or part of a captured payment' })
  refund(@Param('orderNumber') orderNumber: string, @Body('amountMinor') amountMinor: string) {
    return this.payments.refund(orderNumber, BigInt(amountMinor));
  }

  @RequirePermission('billing:read')
  @Post('reconcile')
  @ApiOperation({
    summary: 'Re-ask the bank about every unresolved payment',
    description: 'Bank callbacks get lost; without this sweep a paid order can stay pending.',
  })
  reconcile() {
    return this.payments.reconcile();
  }
}
