import { EventScope } from '../../infra/auth/actor';
import { Throttle } from '@nestjs/throttler';
import { GUEST_PAGE_LIMITS } from '../../infra/auth/throttler.guard';
import { Body, Controller, Delete, Get, Header, NotFoundException, Param, Patch, Query, Res, UseInterceptors } from '@nestjs/common';
import { JobRecoveryInterceptor } from '../../common/interceptors/job-recovery.interceptor';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { PrismaService } from '../../prisma/prisma.service';
import { AcknowledgementsService } from './acknowledgements.service';
import { ContributionPageDto, ModerateGalleryDto, PrivateImageQuery, EventMediaParams } from './contribution.dto';
import { GuestMediaService } from './guest-media.service';
import { sendPrivateImage } from './contributions.controller';

@ApiTags('guest-contributions')
@UseInterceptors(JobRecoveryInterceptor)
@EventScope('eventId')
@Controller('events/:eventId')
export class ContributionsHostController {
  constructor(private readonly acknowledgements: AcknowledgementsService, private readonly media: GuestMediaService, private readonly prisma: PrismaService) {}
  @RequirePermission('guest:contact:read')
  @Header('Cache-Control', 'private, no-store')
  @Get('acknowledgements')
  @ApiOperation({ summary: 'Private acknowledgement records, including actual signer and represented subject' })
  acknowledgementsList(@Param('eventId') eventId: string, @Query() page: ContributionPageDto) {
    return this.acknowledgements.forHost(eventId, page);
  }
  @RequirePermission('guest:contact:read')
  @Header('Cache-Control', 'private, no-store')
  @Throttle(GUEST_PAGE_LIMITS)
  @Get('acknowledgements/:acknowledgementId/file')
  @ApiOperation({ summary: 'Read a private drawn acknowledgement image' })
  async acknowledgementFile(@Param('eventId') eventId: string, @Param('acknowledgementId') id: string, @Res() response: Response) {
    const record = await this.prisma.guestAcknowledgement.findFirst({ where: { id, eventId }, select: { mediaId: true } });
    if (!record?.mediaId) throw new NotFoundException('No drawn acknowledgement here');
    sendPrivateImage(response, await this.media.readHost(eventId, record.mediaId, 'SIGNATURE', 'display'));
  }
  @RequirePermission('guest:write')
  @Header('Cache-Control', 'private, no-store')
  @Get('gallery')
  @ApiOperation({ summary: 'Gallery processing and moderation queue for this event' })
  gallery(@Param('eventId') eventId: string, @Query() page: ContributionPageDto) {
    return this.media.listHost(eventId, page);
  }
  @RequirePermission('guest:write')
  @Patch('gallery/:mediaId')
  @ApiOperation({ summary: 'Approve or reject a processed gallery photo' })
  moderate(@Param() params: EventMediaParams, @CurrentActor() actor: RequestActor, @Body() dto: ModerateGalleryDto) {
    return this.media.moderate(params.eventId, params.mediaId, dto.moderationStatus as 'APPROVED' | 'REJECTED', actor.userId);
  }
  @RequirePermission('guest:write')
  @Header('Cache-Control', 'private, no-store')
  @Throttle(GUEST_PAGE_LIMITS)
  @Get('gallery/:mediaId/file')
  @ApiOperation({ summary: 'Read a processed gallery photo for moderation' })
  async galleryFile(@Param() params: EventMediaParams, @Query() query: PrivateImageQuery, @Res() response: Response) {
    sendPrivateImage(response, await this.media.readHost(params.eventId, params.mediaId, 'GALLERY', query.variant ?? 'display'));
  }
  @RequirePermission('guest:write')
  @Delete('gallery/:mediaId')
  @ApiOperation({ summary: 'Remove a gallery photo and queue its private files for cleanup' })
  remove(@Param('eventId') eventId: string, @Param('mediaId') id: string) { return this.media.removeHost(eventId, id); }
}
