import { Module } from '@nestjs/common';
import { JobsModule } from '../../infra/jobs/jobs.module';
import { DevelopmentController } from './development.controller';
import { DevelopmentService } from './development.service';

@Module({
  imports: [JobsModule],
  controllers: [DevelopmentController],
  providers: [DevelopmentService],
})
export class DevelopmentModule {}
