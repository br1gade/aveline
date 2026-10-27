import { Body, Controller, Header, Param, Post } from '@nestjs/common';
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
  preview(@CurrentActor() actor: RequestActor, @Param('slug') slug: string, @Body() dto: TemplateUpgradePreviewDto) {
    return this.adoption.preview(actor.userId, slug, dto);
  }
}
