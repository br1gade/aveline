import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, OrganizationScope, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { RequestLanguage } from '../../common/request-language';
import { InvoicePageDto, InvoicePageQuery } from './dto/invoice-pages.dto';
import { InvoicePagesService } from './invoice-pages.service';

@ApiTags('billing')
@Controller('invoices')
export class InvoicePagesController {
  constructor(private readonly invoices: InvoicePagesService) {}

  @RequirePermission('billing:read')
  @OrganizationScope()
  @Get('page')
  @ApiOkResponse({ type: InvoicePageDto })
  @ApiOperation({ summary: 'Page this organization’s invoices, newest first' })
  page(@CurrentActor() actor: RequestActor, @Query() query: InvoicePageQuery, @RequestLanguage() locale: string) {
    return this.invoices.page(actor.organizationId ?? '', query, locale);
  }
}
