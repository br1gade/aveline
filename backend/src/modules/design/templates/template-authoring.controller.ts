import { Body, Controller, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor, RequirePermission } from '../../../infra/auth/actor';
import { TemplateAuthoringService } from './template-authoring.service';
import { CreateTemplateDto, PatchTemplateDraftDto, PublishTemplateDto, TemplateAssignmentDto, TemplateRevisionDto } from './template.dto';

class TemplateInventoryQuery {
  @IsOptional() @IsString() @MaxLength(128) cursor?: string;
}
@ApiTags('template-authoring')
@Controller('design-templates')
export class TemplateAuthoringController {
  constructor(private readonly templates: TemplateAuthoringService) {}
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:author') @Get()
  @ApiOperation({ summary: 'Page the authorized staff template inventory; SUPPORT sees assigned templates only' })
  list(@CurrentActor() actor: RequestActor, @Query() query: TemplateInventoryQuery) { return this.templates.list(actor.userId, query.cursor); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:assign') @Post()
  @ApiOperation({ summary: 'ADMIN creates an inactive shared or organization-private template with its first draft' })
  create(@CurrentActor() actor: RequestActor, @Body() dto: CreateTemplateDto) { return this.templates.create(actor.userId, dto); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:author') @Get(':templateId')
  @ApiOperation({ summary: 'Read template history and open draft; SUPPORT requires an active assignment' })
  read(@CurrentActor() actor: RequestActor, @Param('templateId') templateId: string) { return this.templates.read(actor.userId, templateId); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:author') @Post(':templateId/drafts')
  @ApiOperation({ summary: 'Open a draft from the immutable selected version' })
  openDraft(@CurrentActor() actor: RequestActor, @Param('templateId') templateId: string, @Body() dto: TemplateRevisionDto) { return this.templates.openDraft(actor.userId, templateId, dto.expectedRevision); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:author') @Patch(':templateId/drafts/:draftId')
  @ApiOperation({ summary: 'Merge renderer definition fields with revision checking' })
  patch(@CurrentActor() actor: RequestActor, @Param() params: { templateId: string; draftId: string }, @Body() dto: PatchTemplateDraftDto) { return this.templates.patch(actor.userId, { ...params, dto }); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:author') @Post(':templateId/drafts/:draftId/discard')
  @ApiOperation({ summary: 'Discard an exact draft revision and retire eligible transient artwork' })
  discard(@CurrentActor() actor: RequestActor, @Param() params: { templateId: string; draftId: string }, @Body() dto: TemplateRevisionDto) { return this.templates.discard(actor.userId, { ...params, ...dto }); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:author') @Post(':templateId/drafts/:draftId/validate')
  @ApiOperation({ summary: 'Validate backend structure; publication remains closed until tested frontend capabilities are deployed' })
  validate(@CurrentActor() actor: RequestActor, @Param() params: { templateId: string; draftId: string }) { return this.templates.validate(actor.userId, params); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:author') @Post(':templateId/drafts/:draftId/preview')
  @ApiOperation({ summary: 'Produce inert synthetic en/ru/fr/hy JSON fixtures without guest data' })
  preview(@CurrentActor() actor: RequestActor, @Param() params: { templateId: string; draftId: string }) { return this.templates.preview(actor.userId, params); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:publish') @Post(':templateId/drafts/:draftId/publish')
  @ApiOperation({ summary: 'ADMIN publication gate; returns 503 until reviewed renderer acceptance exists' })
  publish(@CurrentActor() actor: RequestActor, @Param() params: { templateId: string; draftId: string }, @Body() dto: PublishTemplateDto) { return this.templates.publish(actor.userId, { ...params, dto }); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:publish') @Post(':templateId/retire')
  @ApiOperation({ summary: 'ADMIN retires future selection while preserving every existing version pin' })
  retire(@CurrentActor() actor: RequestActor, @Param('templateId') templateId: string, @Body() dto: TemplateRevisionDto) { return this.templates.retire(actor.userId, templateId, dto.expectedRevision); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:assign') @Post(':templateId/assignments')
  @ApiOperation({ summary: 'ADMIN assigns active SUPPORT without creating customer membership' })
  assign(@CurrentActor() actor: RequestActor, @Param('templateId') templateId: string, @Body() dto: TemplateAssignmentDto) { return this.templates.assign(actor.userId, templateId, dto); }
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('template:assign') @Post(':templateId/assignments/revoke')
  @ApiOperation({ summary: 'ADMIN revokes SUPPORT access atomically' })
  revoke(@CurrentActor() actor: RequestActor, @Param('templateId') templateId: string, @Body() dto: TemplateAssignmentDto) { return this.templates.assign(actor.userId, templateId, dto, true); }
}
