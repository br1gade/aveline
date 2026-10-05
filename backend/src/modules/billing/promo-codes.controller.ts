import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentActor,
  OrganizationScope,
  RequestActor,
  RequirePermission,
} from '../../infra/auth/actor';
import { CreatePromoCodeDto, UpdatePromoCodeDto } from './dto/promo-code.dto';
import { PromoCodesService } from './promo-codes.service';

@ApiTags('billing')
@Controller('promo-codes')
export class PromoCodesController {
  constructor(private readonly promoCodes: PromoCodesService) {}

  @RequirePermission('billing:read')
  @OrganizationScope()
  @Get()
  @ApiOperation({ summary: 'Your promo codes, with how much of each is left' })
  list(@CurrentActor() actor: RequestActor) {
    return this.promoCodes.list(actor.organizationId ?? '');
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Post()
  @ApiOperation({
    summary: 'Create a promo code',
    description: 'Codes are case-insensitive and stored upper-cased.',
  })
  create(@CurrentActor() actor: RequestActor, @Body() dto: CreatePromoCodeDto) {
    return this.promoCodes.create(actor.organizationId ?? '', dto);
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Patch(':codeId')
  @ApiOperation({
    summary: 'Change a code’s limits',
    description: 'The discount itself is immutable; withdraw a code by deactivating it.',
  })
  update(
    @CurrentActor() actor: RequestActor,
    @Param('codeId') codeId: string,
    @Body() dto: UpdatePromoCodeDto,
  ) {
    return this.promoCodes.update(actor.organizationId ?? '', codeId, dto);
  }

  @RequirePermission('billing:write')
  @OrganizationScope()
  @Delete(':codeId')
  @ApiOperation({
    summary: 'Deactivate a code',
    description: 'Never deleted: orders record the discount they were given.',
  })
  deactivate(@CurrentActor() actor: RequestActor, @Param('codeId') codeId: string) {
    return this.promoCodes.deactivate(actor.organizationId ?? '', codeId);
  }
}
