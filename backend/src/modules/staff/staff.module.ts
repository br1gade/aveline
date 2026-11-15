import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { PilotStatsService } from './pilot-stats.service';
import { StaffService } from './staff.service';

@Module({
  controllers: [StaffController],
  providers: [StaffService, PilotStatsService],
})
export class StaffModule {}
