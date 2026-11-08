import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSubjectRequestStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import {
  CurrentActor,
  Public,
  RequestActor,
  RequirePermission,
} from '../../infra/auth/actor';
import {
  ConfirmExportDeliveryDto,
  CreateDataSubjectRequestDto,
  UpdateDataSubjectRequestDto,
} from './dto/privacy.dto';
import { PrivacyService } from './privacy.service';
import { PaginationQuery } from '../../common/dto/pagination.dto';

class ListRequestsQuery {
  @IsOptional()
  @IsEnum(DataSubjectRequestStatus)
  status?: DataSubjectRequestStatus;
}

@ApiTags('privacy')
@Controller('privacy/requests')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  // Anyone may ask. A data subject is usually a guest with no account, so
  // requiring one would make the right unexercisable.
  @Public()
  @Post()
  @ApiOperation({
    summary: 'Ask what is held about you, or ask for it to go',
    description:
      'Always answers the same way, whether or not anything is held — saying ' +
      '"we hold nothing about you" is itself information about that address.',
  })
  submit(@Body() dto: CreateDataSubjectRequestDto) {
    return this.privacy.submit(dto);
  }

  @RequirePermission('privacy:manage')
  @Get()
  @ApiOperation({ summary: 'Open requests, soonest due first' })
  list(@Query() query: ListRequestsQuery) {
    return this.privacy.list(query.status);
  }

  @RequirePermission('privacy:manage')
  @Get(':requestId/submissions')
  @ApiOperation({ summary: 'Paged, unverified public submissions; never identity evidence or staff notes' })
  submissions(@Param('requestId') requestId: string, @Query() query: PaginationQuery) {
    return this.privacy.submissions(requestId, query);
  }

  @RequirePermission('privacy:manage')
  @Patch(':requestId')
  @ApiOperation({
    summary: 'Move a request through verification',
    description: 'Set IN_PROGRESS only once the requester’s identity is established.',
  })
  update(
    @CurrentActor() actor: RequestActor,
    @Param('requestId') requestId: string,
    @Body() dto: UpdateDataSubjectRequestDto,
  ) {
    return this.privacy.update(requestId, actor.userId, dto);
  }

  @RequirePermission('privacy:manage')
  @Post(':requestId/fulfil')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Carry out a verified request',
    description:
      'Exports generate current data until delivery is confirmed; erasures anonymise in place. Refused ' +
      'unless the request is IN_PROGRESS, because acting on an unverified ' +
      'request is itself a breach.',
  })
  fulfil(@CurrentActor() actor: RequestActor, @Param('requestId') requestId: string) {
    return this.privacy.fulfil(requestId, actor.userId);
  }

  @RequirePermission('privacy:manage')
  @Post(':requestId/confirm-delivery')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Confirm delivery of the latest verified privacy export' })
  confirmDelivery(
    @CurrentActor() actor: RequestActor,
    @Param('requestId') requestId: string,
    @Body() dto: ConfirmExportDeliveryDto,
  ) {
    return this.privacy.confirmExportDelivery(requestId, actor.userId, dto.generationId);
  }
}
