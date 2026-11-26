import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CurrentActor,
  OrganizationScope,
  Public,
  RequestActor,
  RequirePermission,
} from '../../infra/auth/actor';
import { GUEST_PAGE_LIMITS } from '../../infra/auth/throttler.guard';
import { PayInvoiceDto, RenewSubscriptionDto, SubscribeDto } from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';
import { RequestLanguage } from '../../common/request-language';
import { InvoiceResponseDto } from './dto/billing-response.dto';

@ApiTags('billing')
@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Public()
  @Get('plans')
  // Our renderer reads it for every visitor to the price page, from one address (FR-147).
  @Throttle(GUEST_PAGE_LIMITS)
  @ApiOperation({ summary: 'The price list, with each plan’s entitlements' })
  @ApiQuery({ name: 'locale', required: false })
  listPlans(@RequestLanguage() locale: string) {
    return this.subscriptions.listPlans(locale);
  }

  @RequirePermission('billing:read')
  @OrganizationScope()
  @Get('subscription')
  @ApiOperation({
    summary: 'Your current subscription',
    description: 'Null when the organization has never subscribed — not an error.',
  })
  @ApiQuery({ name: 'locale', required: false })
  current(@CurrentActor() actor: RequestActor, @RequestLanguage() locale: string) {
    return this.subscriptions.current(actor.organizationId ?? '', locale);
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post('subscription')
  @ApiOperation({
    summary: 'Start or change a subscription',
    description:
      'Free takes effect after a current paid period. A paid plan issues an invoice and ' +
      'returns a bank form URL; access begins when that payment confirms. ' +
      'An unconfigured provider returns 404 before billing records change.',
  })
  @ApiQuery({ name: 'locale', required: false })
  subscribe(@CurrentActor() actor: RequestActor, @Body() dto: SubscribeDto, @RequestLanguage() locale: string) {
    return this.subscriptions.subscribe(actor.organizationId ?? '', dto, { actor, locale });
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post('subscription/renew')
  @ApiOperation({ summary: 'Manually pay for the next subscription period', description: 'Requires the displayed quote and currentPeriodEnd. Early payment reserves the next period; late payment buys a full period at settlement. No saved-card charge.' })
  renew(@CurrentActor() actor: RequestActor, @Body() dto: RenewSubscriptionDto, @RequestLanguage() locale: string) {
    return this.subscriptions.renew(actor.organizationId ?? '', dto, { actor, locale });
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Delete('subscription/pending-free')
  @ApiOperation({ summary: 'Withdraw a scheduled Free change before it takes effect' })
  withdrawFreeChange(@CurrentActor() actor: RequestActor, @RequestLanguage() locale: string) {
    return this.subscriptions.withdrawFreeChange(actor.organizationId ?? '', locale);
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post('subscription/cancel')
  @ApiOperation({
    summary: 'Cancel at the end of the paid period',
    description: 'Access continues until currentPeriodEnd. Reversible until then.',
  })
  cancel(@CurrentActor() actor: RequestActor, @RequestLanguage() locale: string) {
    return this.subscriptions.cancel(actor.organizationId ?? '', locale);
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post('subscription/resume')
  @ApiOperation({ summary: 'Undo a cancellation before the period ends' })
  resume(@CurrentActor() actor: RequestActor, @RequestLanguage() locale: string) {
    return this.subscriptions.resume(actor.organizationId ?? '', locale);
  }

  @RequirePermission('billing:read')
  @OrganizationScope()
  @Get('invoices')
  @ApiOperation({ summary: 'Your invoices, newest first' })
  @ApiOkResponse({ type: InvoiceResponseDto, isArray: true })
  @ApiQuery({ name: 'locale', required: false })
  listInvoices(@CurrentActor() actor: RequestActor, @RequestLanguage() locale: string) {
    return this.subscriptions.listInvoices(actor.organizationId ?? '', locale);
  }

  @RequirePermission('billing:read')
  @OrganizationScope()
  @Get('invoices/:number')
  @ApiOperation({ summary: 'One invoice, with the line items captured at issue' })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @ApiQuery({ name: 'locale', required: false })
  findInvoice(@CurrentActor() actor: RequestActor, @Param('number') number: string, @RequestLanguage() locale: string) {
    return this.subscriptions.findInvoice(actor.organizationId ?? '', number, locale);
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post('invoices/:number/pay')
  @ApiOperation({ summary: 'Pay or retry the exact open invoice without changing its purchase intent' })
  payInvoice(@CurrentActor() actor: RequestActor, @Param('number') number: string, @Body() dto: PayInvoiceDto, @RequestLanguage() locale: string) {
    return this.subscriptions.payExistingInvoice(actor.organizationId ?? '', number, dto, { actor, locale });
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post('invoices/:number/confirm')
  @ApiOperation({
    summary: 'Settle an invoice after the payer returns from the bank',
    description: 'Server-to-server check. A retried call never activates twice.',
  })
  @ApiQuery({ name: 'locale', required: false })
  confirm(@CurrentActor() actor: RequestActor, @Param('number') number: string, @RequestLanguage() locale: string) {
    return this.subscriptions.confirmPayment(actor.organizationId ?? '', number, locale);
  }
}
