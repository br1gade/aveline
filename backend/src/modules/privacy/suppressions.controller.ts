import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MessageChannel, SuppressionReason } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CurrentActor,
  OrganizationScope,
  RequestActor,
  RequirePermission,
} from '../../infra/auth/actor';
import { SuppressionService } from '../communications/suppression.service';

class SuppressDto {
  @IsEnum(MessageChannel)
  channel!: MessageChannel;

  @IsString()
  @MaxLength(200)
  address!: string;

  @IsOptional()
  @IsEnum(SuppressionReason)
  reason?: SuppressionReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@ApiTags('privacy')
@Controller('suppressions')
export class SuppressionsController {
  constructor(private readonly suppressions: SuppressionService) {}

  @RequirePermission('guest:contact:read')
  @OrganizationScope()
  @Get()
  @ApiOperation({
    summary: 'Addresses that will not be contacted',
    description: 'Includes platform-wide entries, marked with scope GLOBAL.',
  })
  list(@CurrentActor() actor: RequestActor) {
    return this.suppressions.list(actor.organizationId ?? '');
  }

  @RequirePermission('guest:write')
  @OrganizationScope()
  @Post()
  @ApiOperation({
    summary: 'Stop contacting an address',
    description: 'Scoped to your organization. Idempotent.',
  })
  suppress(@CurrentActor() actor: RequestActor, @Body() dto: SuppressDto) {
    return this.suppressions.suppress({
      organizationId: actor.organizationId ?? '',
      channel: dto.channel,
      address: dto.address,
      reason: dto.reason ?? SuppressionReason.MANUAL,
      notes: dto.notes,
    });
  }

  @RequirePermission('guest:write')
  @OrganizationScope()
  @Delete(':suppressionId')
  @ApiOperation({
    summary: 'Resume contacting an address',
    description:
      'Only your own entries. A platform-wide suppression after a bounce or ' +
      'a complaint cannot be lifted here.',
  })
  unsuppress(@CurrentActor() actor: RequestActor, @Param('suppressionId') suppressionId: string) {
    return this.suppressions.unsuppress(actor.organizationId ?? '', suppressionId);
  }
}
