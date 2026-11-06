import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiPropertyOptional, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { EventScope, RequirePermission } from '../../infra/auth/actor';
import { TemplatePreviewsService } from './template-previews.service';
import { DraftPreviewDto } from './dto/draft-preview.dto';

class PreviewLocaleQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}
class TemplatePreviewQuery extends PreviewLocaleQuery {
  @ApiPropertyOptional({ description: 'Defaults to the selected template' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  templateKey?: string;
}

@ApiTags('design')
@Controller()
@EventScope('eventId')
export class TemplatePreviewsController {
  constructor(private readonly previews: TemplatePreviewsService) {}

  @RequirePermission('invitation:read')
  @Get('events/:eventId/design-templates/:templateKey/preview')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Synthetic template preview payload for the invitation renderer' })
  catalogue(@Param('eventId') eventId: string, @Param('templateKey') templateKey: string, @Query() query: PreviewLocaleQuery) {
    return this.previews.catalogue(eventId, templateKey, query.locale);
  }

  @RequirePermission('invitation:read')
  @EventScope('invitationSlug')
  @Get('invitations/:slug/template-preview')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Preview event content with a template without publishing or changing it' })
  forEvent(@Param('slug') slug: string, @Query() query: TemplatePreviewQuery) {
    return this.previews.forEvent(slug, query);
  }

  @RequirePermission('invitation:design')
  @EventScope('invitationSlug')
  @Post('invitations/:slug/template-preview')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Preview one unsaved block edit through the invitation serializer, without writing' })
  draft(@Param('slug') slug: string, @Query() query: TemplatePreviewQuery, @Body() dto: DraftPreviewDto) {
    return this.previews.forEvent(slug, query, dto);
  }
}
