import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OperationsService } from './operations.service';

@ApiTags('operations')
@Controller('events/:eventId')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Everything the operations screen needs, in one request',
    description:
      'Headcount, catering, bar, playlist and invitation engagement together. ' +
      'Prefer this over the individual endpoints when rendering a screen.',
  })
  dashboard(@Param('eventId') eventId: string) {
    return this.operations.dashboard(eventId);
  }

  @Get('headcount')
  @ApiOperation({ summary: 'Live headcount by response, household and side' })
  headcount(@Param('eventId') eventId: string) {
    return this.operations.headcount(eventId);
  }

  @Get('catering-sheet')
  @ApiOperation({ summary: 'Covers and dietary requirements for the venue' })
  catering(@Param('eventId') eventId: string) {
    return this.operations.cateringSheet(eventId);
  }

  @Get('bar-sheet')
  @ApiOperation({ summary: 'Drink preferences aggregated into quantities' })
  bar(@Param('eventId') eventId: string) {
    return this.operations.barSheet(eventId);
  }

  @Get('playlist')
  @ApiOperation({ summary: 'Deduplicated song requests' })
  playlist(@Param('eventId') eventId: string) {
    return this.operations.playlist(eventId);
  }

  @Get('guest-book')
  @ApiOperation({ summary: 'Messages left by guests' })
  guestBook(@Param('eventId') eventId: string) {
    return this.operations.guestBook(eventId);
  }
}
