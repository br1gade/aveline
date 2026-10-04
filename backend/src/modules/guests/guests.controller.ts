import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GuestsService } from './guests.service';

@ApiTags('guests')
@Controller('events/:eventId')
export class GuestsController {
  constructor(private readonly guests: GuestsService) {}

  @Get('guests')
  @ApiOperation({ summary: 'Guest graph grouped by household' })
  list(@Param('eventId') eventId: string) {
    return this.guests.listByHousehold(eventId);
  }

  @Get('find-seat')
  @ApiOperation({ summary: 'Guest-facing seat lookup by name' })
  findSeat(@Param('eventId') eventId: string, @Query('q') q: string) {
    return this.guests.findSeat(eventId, q ?? '');
  }
}
