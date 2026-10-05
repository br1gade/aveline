import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
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
    summary: 'Generate an export',
    description:
      'CSV is generated inline and the response carries its URL. The status ' +
      'field exists for the formats that will be queued.',
  })
  create(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') eventId: string,
    @Body() dto: CreateExportDto,
  ) {
    return this.exports.create(eventId, actor.userId, dto);
  }

  @RequirePermission('operations:read')
  @Get(':exportId')
  @ApiOperation({ summary: 'One export and its file' })
  findOne(@Param('eventId') eventId: string, @Param('exportId') exportId: string) {
    return this.exports.findOne(eventId, exportId);
  }
}
