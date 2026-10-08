import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { AnswersSheetService } from './answers-sheet.service';
import { OperationsService } from './operations.service';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, AnswersSheetService],
  exports: [OperationsService],
})
export class OperationsModule {}
