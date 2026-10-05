import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentActor,
  OrganizationScope,
  Public,
  RequestActor,
  RequirePermission,
} from '../../infra/auth/actor';
import { SubscribeDto } from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('billing')
@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'The price list, with each plan’s entitlements' })
  listPlans() {
    return this.subscriptions.listPlans();
  }

  @RequirePermission('billing:read')
  @OrganizationScope()
  @Get('subscription')
  @ApiOperation({
    summary: 'Your current subscription',
    description: 'Null when the organization has never subscribed — not an error.',
  })
  current(@CurrentActor() actor: RequestActor) {
    return this.subscriptions.current(actor.organizationId ?? '');
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post('subscription')
  @ApiOperation({
    summary: 'Start or change a subscription',
    description:
      'A free plan takes effect at once. A paid one issues an invoice and ' +
      'returns a bank form URL; access begins when that payment confirms.',
  })
  subscribe(@CurrentActor() actor: RequestActor, @Body() dto: SubscribeDto) {
    return this.subscriptions.subscribe(actor.organizationId ?? '', dto);
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post('subscription/cancel')
  @ApiOperation({
    summary: 'Cancel at the end of the paid period',
    description: 'Access continues until currentPeriodEnd. Reversible until then.',
  })
  cancel(@CurrentActor() actor: RequestActor) {
    return this.subscriptions.cancel(actor.organizationId ?? '');
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post('subscription/resume')
  @ApiOperation({ summary: 'Undo a cancellation before the period ends' })
  resume(@CurrentActor() actor: RequestActor) {
    return this.subscriptions.resume(actor.organizationId ?? '');
  }

  @RequirePermission('billing:read')
  @OrganizationScope()
  @Get('invoices')
  @ApiOperation({ summary: 'Your invoices, newest first' })
  listInvoices(@CurrentActor() actor: RequestActor) {
    return this.subscriptions.listInvoices(actor.organizationId ?? '');
  }

  @RequirePermission('billing:read')
  @OrganizationScope()
  @Get('invoices/:number')
  @ApiOperation({ summary: 'One invoice, with the line items captured at issue' })
  findInvoice(@CurrentActor() actor: RequestActor, @Param('number') number: string) {
    return this.subscriptions.findInvoice(actor.organizationId ?? '', number);
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post('invoices/:number/confirm')
  @ApiOperation({
    summary: 'Settle an invoice after the payer returns from the bank',
    description: 'Server-to-server check. A retried call never activates twice.',
  })
  confirm(@CurrentActor() actor: RequestActor, @Param('number') number: string) {
    return this.subscriptions.confirmPayment(actor.organizationId ?? '', number);
  }
}
