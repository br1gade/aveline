import { Body, Controller, Get, Header, Param, Post, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { actorCan, CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { CreateExportDto } from './dto/export.dto';
import { ExportsService } from './exports.service';

@ApiTags('exports')
@Controller('events/:eventId/exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @RequirePermission('operations:read')
  @Get()
  @ApiOperation({ summary: 'Past exports, newest first' })
  list(@Param('eventId') eventId: string) {
    return this.exports.list(eventId);
  }

  @RequirePermission('operations:read')
  @Post()
  @ApiOperation({
    summary: 'Ask for an export',
    description:
      'Records the export and returns its downloadPath. The file is built when ' +
      'it is downloaded, by a signed-in caller — there is no public link. A ' +
      'ticket manifest needs guest:contact:read.',
  })
  create(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') eventId: string,
    @Body() dto: CreateExportDto,
  ) {
    return this.exports.create(eventId, actor.userId, dto, actorCan(actor, 'guest:contact:read'));
  }

  @RequirePermission('operations:read')
  @Get(':exportId')
  @ApiOperation({ summary: 'One export' })
  findOne(@Param('eventId') eventId: string, @Param('exportId') exportId: string) {
    return this.exports.findOne(eventId, exportId);
  }

  @RequirePermission('operations:read')
  @Get(':exportId/download')
  @ApiProduces('text/csv')
  // Guest data: no shared cache or browser history keeps a copy.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Download an export',
    description:
      'Built now from the event as it is. Email and phone columns appear only ' +
      'for a caller with guest:contact:read.',
  })
  async download(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') eventId: string,
    @Param('exportId') exportId: string,
  ) {
    const file = await this.exports.download(eventId, exportId, actorCan(actor, 'guest:contact:read'));
    return new StreamableFile(Buffer.from(file.csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${file.filename}"`,
    });
  }
}
