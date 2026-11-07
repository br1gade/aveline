import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentActor, EventScope, Public, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { GUEST_PAGE_LIMITS } from '../../infra/auth/throttler.guard';
import { PublishShowTicketInventoryDto } from './dto/show-ticket-inventory.dto';
import { ShowTicketInventoryService } from './show-ticket-inventory.service';

@ApiTags('ticketing')
@Controller()
export class ShowTicketInventoryController {
  constructor(private readonly inventory: ShowTicketInventoryService) {}

  @RequirePermission('event:write')
  @EventScope('eventId')
  @Post('events/:eventId/ticket-inventory')
  @ApiOperation({ summary: 'Publish a show’s numbered seats and unnumbered zones' })
  publish(@Param('eventId') eventId: string, @Body() dto: PublishShowTicketInventoryDto, @CurrentActor() actor: RequestActor) {
    return this.inventory.publish(eventId, dto, actor.userId);
  }

  @RequirePermission('event:read')
  @EventScope('eventId')
  @Get('events/:eventId/ticket-inventory')
  @ApiOperation({ summary: 'Read the show’s published inventory configuration' })
  read(@Param('eventId') eventId: string) {
    return this.inventory.read(eventId);
  }

  @Public()
  @Throttle(GUEST_PAGE_LIMITS)
  @Get('public/events/:slug/ticket-inventory/:sectionKey')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read current seat or zone availability for a published show section' })
  readSection(@Param('slug') slug: string, @Param('sectionKey') sectionKey: string) {
    return this.inventory.readPublicSection(slug, sectionKey);
  }
}
