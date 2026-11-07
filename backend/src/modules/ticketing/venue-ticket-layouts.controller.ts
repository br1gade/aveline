import { BadRequestException, Body, Controller, Get, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentActor, EventScope, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { PublishVenueTicketLayoutDto, SelectVenueTicketLayoutDto, VenueTicketLayoutVersionDto } from './dto/venue-ticket-layout.dto';
import { MAX_TICKET_LAYOUT_CSV_BYTES } from './venue-ticket-layout-csv';
import { VenueTicketLayoutsService } from './venue-ticket-layouts.service';

@ApiTags('ticketing')
@Controller()
export class VenueTicketLayoutsController {
  constructor(private readonly layouts: VenueTicketLayoutsService) {}

  @RequirePermission('directory:manage')
  @Post('venue-profiles/:profileId/ticket-layouts')
  @ApiOperation({ summary: 'Publish an immutable numbered and unnumbered venue layout version' })
  publish(@Param('profileId') profileId: string, @Body() dto: PublishVenueTicketLayoutDto, @CurrentActor() actor: RequestActor) {
    return this.layouts.publish(profileId, dto, actor.userId);
  }

  @RequirePermission('directory:manage')
  @Post('venue-profiles/:profileId/ticket-layouts/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_TICKET_LAYOUT_CSV_BYTES, files: 1, fields: 3, fieldSize: 400, parts: 4 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'key', 'name', 'expectedVersion'], properties: {
    file: { type: 'string', format: 'binary' }, key: { type: 'string' }, name: { type: 'string' }, expectedVersion: { type: 'integer', minimum: 0 },
  } } })
  @ApiOperation({ summary: 'Publish a version of a large venue ticket layout from CSV' })
  importCsv(@Param('profileId') profileId: string, @Body() dto: VenueTicketLayoutVersionDto, @CurrentActor() actor: RequestActor,
    @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file: a ticket layout CSV is required');
    return this.layouts.importCsv(profileId, dto, file.buffer, actor.userId);
  }

  @EventScope('eventId')
  @RequirePermission('event:read')
  @Get('events/:eventId/venues/:venueId/ticket-layouts')
  @ApiOperation({ summary: 'List the latest layout versions for this event venue' })
  list(@Param('eventId') eventId: string, @Param('venueId') venueId: string) {
    return this.layouts.list({ eventId, venueId });
  }

  @EventScope('eventId')
  @RequirePermission('event:read')
  @Get('events/:eventId/venues/:venueId/ticket-layouts/:versionId')
  @ApiOperation({ summary: 'Preview an immutable layout version for this event venue' })
  preview(@Param('eventId') eventId: string, @Param('venueId') venueId: string, @Param('versionId') versionId: string) {
    return this.layouts.preview({ eventId, venueId }, versionId);
  }

  @EventScope('eventId')
  @RequirePermission('event:read')
  @Get('events/:eventId/venues/:venueId/ticket-layout')
  @ApiOperation({ summary: 'Read the layout selected for this event venue' })
  current(@Param('eventId') eventId: string, @Param('venueId') venueId: string) {
    return this.layouts.current({ eventId, venueId });
  }

  @EventScope('eventId')
  @RequirePermission('event:write')
  @Put('events/:eventId/venues/:venueId/ticket-layout')
  @ApiOperation({ summary: 'Select a venue layout version without activating ticket inventory' })
  select(@Param('eventId') eventId: string, @Param('venueId') venueId: string, @Body() dto: SelectVenueTicketLayoutDto, @CurrentActor() actor: RequestActor) {
    return this.layouts.select({ eventId, venueId }, dto.versionId, actor.userId);
  }
}
