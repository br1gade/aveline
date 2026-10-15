import { Body, Controller, Get, Header, Param, Post, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { CreateExportSnapshotDto } from './dto/export-snapshot.dto';
import { ExportSnapshotsService } from './export-snapshots.service';

@ApiTags('exports')
@Controller('events/:eventId/export-snapshots')
export class ExportSnapshotsController {
  constructor(private readonly snapshots: ExportSnapshotsService) {}

  @RequirePermission('operations:read')
  @Get()
  @ApiOperation({ summary: 'Latest 50 fixed snapshots; poll individual jobs for readiness' })
  list(@Param('eventId') eventId: string) { return this.snapshots.list(eventId); }

  @RequirePermission('operations:read')
  @Post()
  @ApiOperation({ summary: 'Queue a private fixed snapshot; use a new idempotency key to regenerate' })
  create(@CurrentActor() actor: RequestActor, @Param('eventId') eventId: string, @Body() dto: CreateExportSnapshotDto) {
    return this.snapshots.create(eventId, actor.userId, dto);
  }

  @RequirePermission('operations:read')
  @Get(':snapshotId')
  @ApiOperation({ summary: 'Snapshot state, generation metadata, expiry and download readiness' })
  findOne(@Param('eventId') eventId: string, @Param('snapshotId') snapshotId: string) { return this.snapshots.findOne(eventId, snapshotId); }

  @RequirePermission('operations:read')
  @Get(':snapshotId/download')
  @ApiProduces('text/csv', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Download stored snapshot bytes with current event/contact authorization' })
  async download(@CurrentActor() actor: RequestActor, @Param('eventId') eventId: string, @Param('snapshotId') snapshotId: string) {
    const file = await this.snapshots.download(eventId, snapshotId, actor.userId);
    return new StreamableFile(file.buffer, { type: file.mimeType, disposition: `attachment; filename="${file.filename}"` });
  }
}
