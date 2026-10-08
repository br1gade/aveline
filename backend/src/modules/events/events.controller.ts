import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { UpdateEventSettingsDto } from './dto/event-settings.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventsService } from './events.service';
import {
  CurrentActor,
  OrganizationScope,
  RequestActor,
  RequirePermission,
} from '../../infra/auth/actor';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  // No permission check of its own: everyone signed in may ask, and the
  // answer is scoped to what they can reach.
  @OrganizationScope()
  @Get()
  @ApiOperation({
    summary: "List the signed-in account's events",
    description:
      "Their organization's events, if their role there can read them, plus any event they " +
      'were invited onto directly. Platform staff see every event.',
  })
  findAll(@CurrentActor() actor: RequestActor) {
    return this.events.findAll(actor);
  }

  // No permission beyond a session and an organization: a host creating their
  // first event has no event to hold a permission on yet.
  @OrganizationScope()
  @Post()
  @ApiOperation({
    summary: 'Create an event, with its draft invitation',
    description:
      'The caller becomes its OWNER. An invitation is created alongside, so ' +
      'there is something to design immediately.',
  })
  create(@CurrentActor() actor: RequestActor, @Body() dto: CreateEventDto) {
    return this.events.create(actor.organizationId ?? '', actor.userId, dto);
  }

  @RequirePermission('event:write')
  @Post(':id/invitation')
  @ApiOperation({
    summary: 'Add an invitation to an event that has none',
    description: 'Only needed when no design template existed when the event was created.',
  })
  createInvitation(@Param('id') id: string, @Body() dto: CreateInvitationDto) {
    return this.events.createInvitation(id, dto.templateKey);
  }

  @RequirePermission('event:read')
  @Get(':id')
  @ApiOperation({ summary: 'Event detail with venues and timeline' })
  findOne(@Param('id') id: string) {
    return this.events.findOne(id);
  }

  @RequirePermission('event:write')
  @Patch(':id')
  @ApiOperation({
    summary: "Correct the event's details",
    description:
      'Title, hosts, type, dates, time zone, languages and side labels. Omitted fields are ' +
      'unchanged. When the date or time moves and guests hold the invitation, `notice` says ' +
      'so; telling them is a separate, deliberate call to /invitations/:slug/notify-changes.',
  })
  updateDetails(@Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.events.updateDetails(id, dto);
  }

  @RequirePermission('member:manage')
  @Get(':id/audit-trail')
  @ApiOperation({
    summary: 'Who changed what on this event',
    description:
      'Successful writes only, newest first. Records that something changed, ' +
      'never the content that changed — a guest list does not belong in a ' +
      'second store.',
  })
  auditTrail(@Param('id') id: string) {
    return this.events.auditTrail(id);
  }

  @RequirePermission('event:write')
  @Patch(':id/settings')
  @ApiOperation({
    summary: 'Change the settings a host flips themselves',
    description:
      'Currently whether automatic RSVP reminders go out. Not a general event ' +
      'PATCH: a date or venue change affects invitations people already hold.',
  })
  updateSettings(@Param('id') id: string, @Body() dto: UpdateEventSettingsDto) {
    return this.events.updateSettings(id, dto);
  }
}
