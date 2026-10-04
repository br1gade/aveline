import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { RequirePermission } from '../../infra/auth/actor';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @RequirePermission('event:read')
  @Get()
  @ApiOperation({ summary: 'List events' })
  findAll(@Query('organizationId') organizationId?: string) {
    return this.events.findAll(organizationId);
  }

  @RequirePermission('event:read')
  @Get(':id')
  @ApiOperation({ summary: 'Event detail with venues and timeline' })
  findOne(@Param('id') id: string) {
    return this.events.findOne(id);
  }
}
