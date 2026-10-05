import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @RequirePermission('event:read')
  @OrganizationScope()
  @Get()
  @ApiOperation({
    summary: "List the signed-in account's events",
    description:
      'Scoped to the actor\'s own organization. Platform staff see every event.',
  })
  findAll(@CurrentActor() actor: RequestActor) {
    return this.events.findAll(actor.organizationId ?? undefined);
  }

  @RequirePermission('event:read')
  @Get(':id')
  @ApiOperation({ summary: 'Event detail with venues and timeline' })
  findOne(@Param('id') id: string) {
    return this.events.findOne(id);
  }
}
