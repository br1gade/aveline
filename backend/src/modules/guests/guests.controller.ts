import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GuestsService } from './guests.service';
import { CheckInService } from './check-in.service';
import { GuestImportService } from './import/guest-import.service';
import { CurrentActor, Public, RequestActor, RequirePermission, actorCan } from '../../infra/auth/actor';

@ApiTags('guests')
@Controller('events/:eventId')
export class GuestsController {
  constructor(
    private readonly guests: GuestsService,
    private readonly imports: GuestImportService,
    private readonly checkIns: CheckInService,
  ) {}

  @RequirePermission('guest:read')
  @Get('guests')
  @ApiOperation({ summary: 'Guest graph grouped by household' })
  list(@Param('eventId') eventId: string, @CurrentActor() actor: RequestActor) {
    return this.guests.listByHousehold(eventId, actorCan(actor, 'guest:contact:read'));
  }

  @RequirePermission('guest:write')
  @Post('guests/import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import a guest list from CSV',
    description:
      'Partial success is intended: good rows are saved and bad ones are ' +
      'reported by their spreadsheet row number. Re-importing reuses existing ' +
      'households rather than duplicating them.',
  })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  importGuests(
    @Param('eventId') eventId: string,
    @CurrentActor() actor: RequestActor,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('A CSV file is required');
    return this.imports.importCsv(eventId, file.originalname, file.buffer, actor.userId);
  }

  @RequirePermission('guest:read')
  @Get('guests/imports')
  @ApiOperation({ summary: 'Recent imports, with their per-row errors' })
  listImports(@Param('eventId') eventId: string) {
    return this.imports.listImports(eventId);
  }

  @RequirePermission('guest:read')
  @Get('guests/:guestId')
  @ApiOperation({
    summary: 'One guest, for an edit form',
    description: 'Contact details and the personal link only with guest:contact:read.',
  })
  findOne(
    @Param('eventId') eventId: string,
    @Param('guestId') guestId: string,
    @CurrentActor() actor: RequestActor,
  ) {
    return this.guests.findOne(eventId, guestId, actorCan(actor, 'guest:contact:read'));
  }

  @RequirePermission('guest:write')
  @Post('guests/:guestId/check-in')
  @ApiOperation({
    summary: 'Record a guest arriving',
    description:
      'A guest can only be checked in once, so two people on the door cannot ' +
      'both record the same arrival. Returns their table and whether they were expected.',
  })
  checkIn(
    @Param('eventId') eventId: string,
    @Param('guestId') guestId: string,
    @CurrentActor() actor: RequestActor,
  ) {
    return this.checkIns.checkIn(eventId, guestId, actor.userId);
  }

  @RequirePermission('guest:write')
  @Delete('guests/:guestId/check-in')
  @ApiOperation({ summary: 'Undo a check-in after a mis-scan' })
  undoCheckIn(@Param('eventId') eventId: string, @Param('guestId') guestId: string) {
    return this.checkIns.undo(eventId, guestId);
  }

  @RequirePermission('operations:read')
  @Get('arrivals')
  @ApiOperation({ summary: 'Live arrivals: expected, arrived, still to come' })
  arrivals(@Param('eventId') eventId: string) {
    return this.checkIns.arrivals(eventId);
  }

  // Guests look themselves up on a phone at the venue.
  @Public()
  @Get('find-seat')
  @ApiOperation({ summary: 'Guest-facing seat lookup by name' })
  findSeat(@Param('eventId') eventId: string, @Query('q') q: string) {
    return this.guests.findSeat(eventId, q ?? '');
  }
}
