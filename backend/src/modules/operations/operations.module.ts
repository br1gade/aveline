import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { AnswersSheetService } from './answers-sheet.service';
import { OperationsService } from './operations.service';
import { OperationsReportsService } from './operations-reports.service';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, AnswersSheetService, OperationsReportsService],
  exports: [OperationsService],
})
export class OperationsModule {}
