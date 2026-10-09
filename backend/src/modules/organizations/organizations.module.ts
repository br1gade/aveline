import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ConciergeController } from './concierge.controller';
import { ConciergeService } from './concierge.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [EventsModule],
  controllers: [OrganizationsController, ConciergeController],
  providers: [OrganizationsService, ConciergeService],
})
export class OrganizationsModule {}
