import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { JobRecoveryInterceptor } from '../../common/interceptors/job-recovery.interceptor';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { AssignSeatDto, CreateTableDto, CreateTablesDto, UpdateTableDto, SeatingSelectionDto } from './dto/seating.dto';
import { SeatingJobsService } from './jobs/seating-jobs.service';
import { CreateSeatingJobDto } from './dto/seating-job.dto';
import { SeatingService } from './seating.service';

@ApiTags('seating')
@UseInterceptors(JobRecoveryInterceptor)
@Controller('events/:eventId')
export class SeatingController {
  constructor(private readonly seating: SeatingService, private readonly jobs: SeatingJobsService) {}

  @RequirePermission('seating:read')
  @Get('seating/arrangements')
  @ApiOperation({ summary: 'Seating arrangements by venue, including the unspecified legacy plan' })
  listArrangements(@Param('eventId') eventId: string) {
    return this.seating.listArrangements(eventId);
  }

  @RequirePermission('seating:read')
  @Get('tables')
  @ApiOperation({ summary: 'Tables with who is seated at each' })
  listTables(@Param('eventId') eventId: string, @Query() selection: SeatingSelectionDto) {
    return this.seating.listTables(eventId, selection.arrangementId);
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
  @Patch('tables/:tableId')
  @ApiOperation({
    summary: 'Change a table — name, seats, zone, venue, position on the plan',
    description: 'Omitted fields are unchanged; null clears zone, venue and position. Never below those seated.',
  })
  updateTable(@Param('eventId') eventId: string, @Param('tableId') tableId: string, @Body() dto: UpdateTableDto) {
    return this.seating.updateTable(eventId, tableId, dto);
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
  unassign(@Param('eventId') eventId: string, @Param('guestId') guestId: string, @Query() selection: SeatingSelectionDto) {
    return this.seating.unassign(eventId, guestId, selection.arrangementId);
  }

  @RequirePermission('seating:write')
  @Post('seats/auto-assign')
  @ApiOperation({ summary: 'Queue additive automatic seating; poll seating/jobs/:jobId for the committed result' })
  autoAssign(@CurrentActor() actor: RequestActor, @Param('eventId') eventId: string,
    @Query() selection: SeatingSelectionDto, @Body() dto: CreateSeatingJobDto) {
    return this.jobs.create(eventId, actor.userId, dto, selection.arrangementId);
  }

  @RequirePermission('seating:read')
  @Get('seating/jobs')
  @ApiOperation({ summary: 'Latest 50 automatic seating jobs for this event' })
  listJobs(@Param('eventId') eventId: string) { return this.jobs.list(eventId); }

  @RequirePermission('seating:read')
  @Get('seating/jobs/:jobId')
  @ApiOperation({ summary: 'Automatic seating status, revisions and committed result' })
  findJob(@Param('eventId') eventId: string, @Param('jobId') jobId: string) { return this.jobs.findOne(eventId, jobId); }

  @RequirePermission('seating:write')
  @Post('seating/publish')
  @ApiOperation({
    summary: 'Let guests see their tables',
    description:
      'Each guest sees their own household’s tables on their personal invitation ' +
      'link, never anyone else’s. Later changes to the plan show at once.',
  })
  publish(@Param('eventId') eventId: string) {
    return this.seating.publish(eventId);
  }

  @RequirePermission('seating:write')
  @Post('seating/unpublish')
  @ApiOperation({ summary: 'Take the tables off guests’ pages again' })
  unpublish(@Param('eventId') eventId: string) {
    return this.seating.unpublish(eventId);
  }
}
