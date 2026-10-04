import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OperationsService } from './operations.service';

@ApiTags('operations')
@Controller('events/:eventId')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

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
