import { Body, Controller, Get, Header, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { CurrentActor, EventScope, RequestActor, RequirePermission } from '../../../infra/auth/actor';
import { TemplateAdoptionService } from './template-adoption.service';
class TemplateUpgradePreviewDto {
  @ApiProperty() @IsString() @MaxLength(128) targetVersionId!: string;
  @ApiProperty() @IsString() @Matches(/^[1-9][0-9]{0,18}$/) expectedDesignRevision!: string;
}
@ApiTags('design')
@Controller('invitations/:slug')
export class TemplateAdoptionController {
  constructor(private readonly adoption: TemplateAdoptionService) {}
  @RequirePermission('invitation:design') @EventScope('invitationSlug')
  @Post('template-upgrade-preview') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Preview an exact immutable version against a fenced event design before explicit confirmation' })
  async preview(@CurrentActor() actor: RequestActor, @Param('slug') slug: string, @Body() dto: TemplateUpgradePreviewDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.adoption.preview(actor.userId, slug, dto);
    response.status(result.state === 'PROCESSING' ? 202 : 201); return result;
  }
  @RequirePermission('invitation:design') @EventScope('invitationSlug')
  @Get('template-upgrade-previews/:previewId') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Poll event-private artwork preparation for an exact requester-bound preview' })
  poll(@CurrentActor() actor: RequestActor, @Param('slug') slug: string, @Param('previewId') previewId: string) {
    return this.adoption.poll(actor.userId, slug, previewId);
  }

}
