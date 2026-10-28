import { Module } from '@nestjs/common';
import { SeatingController } from './seating.controller';
import { SeatingService } from './seating.service';

import { SeatingJobsService } from './jobs/seating-jobs.service';
import { SeatingQueue } from './jobs/seating-queue';
import { SeatingRunner } from './jobs/seating-runner';
import { SeatingPlanner } from './jobs/seating-planner';

@Module({
  controllers: [SeatingController],
  providers: [SeatingService, SeatingJobsService, SeatingQueue, SeatingRunner, SeatingPlanner],
  exports: [SeatingService],
})
export class SeatingModule {}
