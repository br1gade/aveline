import { OwnOrganizationsController } from './own-organizations.controller';
import { OrganizationReviewsService } from './organization-reviews.service';
import { OrganizationReviewsController } from './organization-reviews.controller';
import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ConciergeController } from './concierge.controller';
import { ConciergeService } from './concierge.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [EventsModule],
  controllers: [OrganizationReviewsController, OrganizationsController, OwnOrganizationsController, ConciergeController],
  providers: [OrganizationReviewsService, OrganizationsService, ConciergeService],
})
export class OrganizationsModule {}
