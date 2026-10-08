import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PaymentEventSource } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StartPaymentDto } from './dto/start-payment.dto';
import { RefundPaymentDto } from '../ticketing/dto/ticket-setup.dto';
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

  /**
   * Refunds a payment that is not for tickets.
   *
   * `billing:write`, not `billing:read`: this moves money out of the business,
   * and was guarded by the read permission until it was noticed. The body is
   * validated, because `BigInt` on a missing or non-numeric value threw a raw
   * 500 on the one endpoint where a malformed request most needs a clear
   * answer.
   *
   * Ticket payments are refused here and refunded by cancelling the order,
   * which voids the tickets in the same act — refunding the money alone left a
   * buyer refunded and still able to get in.
   */
  @RequirePermission('billing:write')
  @Post(':orderNumber/refund')
  @ApiOperation({
    summary: 'Refund all or part of a captured payment',
    description:
      'Not for ticket payments: cancel the order instead, which refunds it and voids its tickets together.',
  })
  refund(@Param('orderNumber') orderNumber: string, @Body() dto: RefundPaymentDto) {
    return this.payments.refundNonTicket(orderNumber, BigInt(dto.amountMinor), dto.reason);
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
