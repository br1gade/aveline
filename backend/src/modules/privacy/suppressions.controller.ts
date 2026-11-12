import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { MessageChannel, SuppressionReason } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  CurrentActor,
  OrganizationScope,
  RequestActor,
  RequirePermission,
} from '../../infra/auth/actor';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { SuppressionService } from '../communications/suppression.service';

/**
 * The other reasons belong to the platform: a bounce, a complaint or an
 * erasure recorded by a host would look like the platform's, and an erasure
 * could never be lifted (FR-99).
 */
const HOST_REASONS = [SuppressionReason.MANUAL] as const;

class SuppressDto {
  @ApiProperty({ enum: MessageChannel })
  @IsEnum(MessageChannel)
  channel!: MessageChannel;

  @ApiProperty({ maxLength: 200, example: 'ani@example.am' })
  @IsString()
  @Matches(/\S/u, { message: 'address must not be blank' })
  @MaxLength(200)
  address!: string;

  @ApiPropertyOptional({ enum: HOST_REASONS, default: SuppressionReason.MANUAL })
  @IsOptional()
  @IsIn(HOST_REASONS)
  reason?: SuppressionReason;

  @ApiPropertyOptional({ maxLength: 500 })
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
    description: 'Includes platform-wide entries, marked with scope GLOBAL. Paged, newest first.',
  })
  list(@CurrentActor() actor: RequestActor, @Query() query: PaginationQuery) {
    return this.suppressions.list(actor.organizationId ?? '', query);
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
