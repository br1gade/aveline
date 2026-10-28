import { AttendancePolicyService } from './attendance-policy.service';
import { AttendancePolicyController } from './attendance-policy.controller';
import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  controllers: [EventsController, TeamController, AttendancePolicyController],
  providers: [EventsService, TeamService, AttendancePolicyService],
  exports: [EventsService],
})
export class EventsModule {}
