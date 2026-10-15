import { PrivateStorageModule } from '../../infra/storage/private/private-storage.module';
import { ExportSnapshotsController } from './export-snapshots.controller';
import { ExportSnapshotsService } from './export-snapshots.service';
import { ExportQueue } from './export-queue';
import { ExportRunner } from './export-runner';
import { Module } from '@nestjs/common';
import { StorageModule } from '../../infra/storage/storage.module';
import { OperationsModule } from '../operations/operations.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [StorageModule, PrivateStorageModule, OperationsModule],
  controllers: [ExportsController, ExportSnapshotsController],
  providers: [ExportsService, ExportSnapshotsService, ExportQueue, ExportRunner],
  exports: [ExportRunner],
})
export class ExportsModule {}
