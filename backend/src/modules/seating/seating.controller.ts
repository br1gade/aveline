import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../infra/auth/actor';
import { AssignSeatDto, CreateTableDto, CreateTablesDto } from './dto/seating.dto';
import { SeatingService } from './seating.service';

@ApiTags('seating')
@Controller('events/:eventId')
export class SeatingController {
  constructor(private readonly seating: SeatingService) {}

  @RequirePermission('seating:read')
  @Get('tables')
  @ApiOperation({ summary: 'Tables with who is seated at each' })
  listTables(@Param('eventId') eventId: string) {
    return this.seating.listTables(eventId);
  }

  @RequirePermission('seating:write')
  @Post('tables')
  @ApiOperation({ summary: 'Add one table' })
  createTable(@Param('eventId') eventId: string, @Body() dto: CreateTableDto) {
    return this.seating.createTable(eventId, dto);
  }

  @RequirePermission('seating:write')
  @Post('tables/bulk')
  @ApiOperation({
    summary: 'Add several identical tables',
    description: 'Twenty tables of ten is one request, not twenty.',
  })
  createTables(@Param('eventId') eventId: string, @Body() dto: CreateTablesDto) {
    return this.seating.createTables(eventId, dto);
  }

  @RequirePermission('seating:write')
  @Delete('tables/:tableId')
  @ApiOperation({
    summary: 'Remove an empty table',
    description: 'Refuses while anyone is seated, rather than silently unseating them.',
  })
  deleteTable(@Param('eventId') eventId: string, @Param('tableId') tableId: string) {
    return this.seating.deleteTable(eventId, tableId);
  }

  @RequirePermission('seating:write')
  @Post('seats')
  @ApiOperation({ summary: 'Seat a guest, or move one already seated' })
  assign(@Param('eventId') eventId: string, @Body() dto: AssignSeatDto) {
    return this.seating.assign(eventId, dto);
  }

  @RequirePermission('seating:write')
  @Delete('seats/:guestId')
  @ApiOperation({ summary: 'Unseat a guest' })
  unassign(@Param('eventId') eventId: string, @Param('guestId') guestId: string) {
    return this.seating.unassign(eventId, guestId);
  }

  @RequirePermission('seating:write')
  @Post('seats/auto-assign')
  @ApiOperation({
    summary: 'Seat everyone who has accepted, keeping households together',
    description:
      'Additive: guests already seated keep their places, so running it after ' +
      'a late RSVP fills gaps rather than rearranging a plan already adjusted by hand. ' +
      'Anything it cannot place is returned with a reason.',
  })
  autoAssign(@Param('eventId') eventId: string) {
    return this.seating.autoAssign(eventId);
  }
}
