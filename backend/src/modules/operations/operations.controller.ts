import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnswersSheetService } from './answers-sheet.service';
import { OperationsService } from './operations.service';
import { RequirePermission } from '../../infra/auth/actor';

@ApiTags('operations')
@Controller('events/:eventId')
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly answers: AnswersSheetService,
  ) {}

  @RequirePermission('operations:read')
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

  @RequirePermission('operations:read')
  @Get('headcount')
  @ApiOperation({ summary: 'Live headcount by response, household and side' })
  headcount(@Param('eventId') eventId: string) {
    return this.operations.headcount(eventId);
  }

  @RequirePermission('operations:read')
  @Get('catering-sheet')
  @ApiOperation({ summary: 'Covers and dietary requirements for the venue' })
  catering(@Param('eventId') eventId: string) {
    return this.operations.cateringSheet(eventId);
  }

  @RequirePermission('operations:read')
  @Get('bar-sheet')
  @ApiOperation({ summary: 'Drink preferences aggregated into quantities' })
  bar(@Param('eventId') eventId: string) {
    return this.operations.barSheet(eventId);
  }

  @RequirePermission('operations:read')
  @Get('playlist')
  @ApiOperation({ summary: 'Deduplicated song requests' })
  playlist(@Param('eventId') eventId: string) {
    return this.operations.playlist(eventId);
  }

  @RequirePermission('operations:read')
  @Get('answers')
  @ApiOperation({
    summary: "What guests answered to the host's own questions",
    description:
      'Per question: each option counted among those coming and among everyone, and every ' +
      'answer with who gave it. Labels in ?locale= if the event publishes it.',
  })
  answersSheet(@Param('eventId') eventId: string, @Query('locale') locale?: string) {
    return this.answers.answersSheet(eventId, locale);
  }

  @RequirePermission('operations:read')
  @Get('guest-book')
  @ApiOperation({ summary: 'Messages left by guests' })
  guestBook(@Param('eventId') eventId: string) {
    return this.operations.guestBook(eventId);
  }
}
