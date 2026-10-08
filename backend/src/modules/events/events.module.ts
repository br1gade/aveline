import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  controllers: [EventsController, TeamController],
  providers: [EventsService, TeamService],
  exports: [EventsService],
})
export class EventsModule {}
