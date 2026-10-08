import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BlockType } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { EventScope, RequirePermission } from '../../infra/auth/actor';
import { DesignService } from './design.service';
import {
  ChooseTemplateDto,
  CreateVenueDto,
  UpdateBlockDto,
  UpdateThemeDto,
  UpdateVenueDto,
  UpsertQuestionDto,
  UpsertTimelineEntryDto,
} from './dto/design.dto';
import { TimelineService } from './timeline.service';
import { VenuesService } from './venues.service';

class CityQuery {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;
}

@ApiTags('design')
@Controller()
export class DesignController {
  constructor(
    private readonly design: DesignService,
    private readonly venues: VenuesService,
    private readonly timeline: TimelineService,
  ) {}

  // Keyed by event rather than platform-wide, so an event-level designer can
  // read it — and so a future plan entitlement can narrow the catalogue per
  // event without moving the route.
  @RequirePermission('invitation:read')
  @Get('events/:eventId/design-templates')
  @ApiOperation({
    summary: 'The template catalogue',
    description: 'Each entry declares the fonts, palettes and blocks it supports.',
  })
  listTemplates() {
    return this.design.listTemplates();
  }

  @RequirePermission('invitation:design')
  @EventScope('invitationSlug')
  @Post('invitations/:slug/template')
  @ApiOperation({
    summary: 'Switch template',
    description:
      'Unsupported blocks are disabled rather than deleted, so switching back ' +
      'does not lose the host’s copy. The theme resets to the new default.',
  })
  chooseTemplate(@Param('slug') slug: string, @Body() dto: ChooseTemplateDto) {
    return this.design.chooseTemplate(slug, dto);
  }

  @RequirePermission('invitation:design')
  @EventScope('invitationSlug')
  @Patch('invitations/:slug/theme')
  @ApiOperation({
    summary: 'Change fonts and colours',
    description:
      'Validated against the template that has to render it; a rejected ' +
      'theme changes nothing and names every problem.',
  })
  updateTheme(@Param('slug') slug: string, @Body() dto: UpdateThemeDto) {
    return this.design.updateTheme(slug, dto);
  }

  @RequirePermission('invitation:design')
  @EventScope('invitationSlug')
  @Patch('invitations/:slug/blocks/:type')
  @ApiOperation({
    summary: 'Edit one block’s content',
    description: 'Which blocks exist, and their order, is the arrangement call.',
  })
  updateBlock(
    @Param('slug') slug: string,
    @Param('type') type: BlockType,
    @Body() dto: UpdateBlockDto,
  ) {
    return this.design.updateBlock(slug, type, dto);
  }

  @RequirePermission('invitation:read')
  @EventScope('invitationSlug')
  @Get('invitations/:slug/questions')
  @ApiOperation({ summary: 'Custom RSVP questions, in order' })
  listQuestions(@Param('slug') slug: string) {
    return this.design.listQuestions(slug);
  }

  @RequirePermission('invitation:design')
  @EventScope('invitationSlug')
  @Post('invitations/:slug/questions')
  @ApiOperation({ summary: 'Add a custom RSVP question' })
  addQuestion(@Param('slug') slug: string, @Body() dto: UpsertQuestionDto) {
    return this.design.addQuestion(slug, dto);
  }

  @RequirePermission('invitation:design')
  @EventScope('invitationSlug')
  @Patch('invitations/:slug/questions/:questionId')
  @ApiOperation({ summary: 'Change a question' })
  updateQuestion(
    @Param('slug') slug: string,
    @Param('questionId') questionId: string,
    @Body() dto: UpsertQuestionDto,
  ) {
    return this.design.updateQuestion(slug, questionId, dto);
  }

  @RequirePermission('invitation:design')
  @EventScope('invitationSlug')
  @Delete('invitations/:slug/questions/:questionId')
  @ApiOperation({
    summary: 'Remove a question',
    description: 'Refused once guests have answered it; make it optional instead.',
  })
  removeQuestion(@Param('slug') slug: string, @Param('questionId') questionId: string) {
    return this.design.removeQuestion(slug, questionId);
  }

  @RequirePermission('event:read')
  @Get('events/:eventId/timeline')
  @ApiOperation({
    summary: 'The running order, soonest first',
    description: 'Read by the TIMELINE block, the vendor brief and the operations view.',
  })
  listTimeline(@Param('eventId') eventId: string) {
    return this.timeline.list(eventId);
  }

  @RequirePermission('event:write')
  @Post('events/:eventId/timeline')
  @ApiOperation({ summary: 'Add something to the running order' })
  createTimelineEntry(@Param('eventId') eventId: string, @Body() dto: UpsertTimelineEntryDto) {
    return this.timeline.create(eventId, dto);
  }

  @RequirePermission('event:write')
  @Patch('events/:eventId/timeline/:entryId')
  @ApiOperation({ summary: 'Change an entry' })
  updateTimelineEntry(
    @Param('eventId') eventId: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpsertTimelineEntryDto,
  ) {
    return this.timeline.update(eventId, entryId, dto);
  }

  @RequirePermission('event:write')
  @Delete('events/:eventId/timeline/:entryId')
  @ApiOperation({ summary: 'Remove an entry' })
  removeTimelineEntry(@Param('eventId') eventId: string, @Param('entryId') entryId: string) {
    return this.timeline.remove(eventId, entryId);
  }

  @RequirePermission('event:read')
  @Get('events/:eventId/venue-profiles')
  @ApiOperation({ summary: 'The reusable venue directory' })
  listProfiles(@Query() query: CityQuery) {
    return this.venues.listProfiles(query.city);
  }

  @RequirePermission('event:read')
  @Get('events/:eventId/venues')
  @ApiOperation({ summary: 'This event’s venues, in order' })
  listVenues(@Param('eventId') eventId: string) {
    return this.venues.listForEvent(eventId);
  }

  @RequirePermission('event:write')
  @Post('events/:eventId/venues')
  @ApiOperation({
    summary: 'Add a venue',
    description:
      'Typed once and reused by the invitation, the map, the timeline and the ' +
      'vendor brief. A directory entry’s details are copied, not referenced.',
  })
  createVenue(@Param('eventId') eventId: string, @Body() dto: CreateVenueDto) {
    return this.venues.create(eventId, dto);
  }

  @RequirePermission('event:write')
  @Patch('events/:eventId/venues/:venueId')
  @ApiOperation({ summary: 'Change a venue' })
  updateVenue(
    @Param('eventId') eventId: string,
    @Param('venueId') venueId: string,
    @Body() dto: UpdateVenueDto,
  ) {
    return this.venues.update(eventId, venueId, dto);
  }

  @RequirePermission('event:write')
  @Delete('events/:eventId/venues/:venueId')
  @ApiOperation({
    summary: 'Remove a venue',
    description: 'Refused while timeline entries or tables still point at it.',
  })
  removeVenue(@Param('eventId') eventId: string, @Param('venueId') venueId: string) {
    return this.venues.remove(eventId, venueId);
  }
}
