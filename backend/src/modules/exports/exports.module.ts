import { Module } from '@nestjs/common';
import { StorageModule } from '../../infra/storage/storage.module';
import { OperationsModule } from '../operations/operations.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [StorageModule, OperationsModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
