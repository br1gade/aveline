import { Module } from '@nestjs/common';
import { DesignController } from './design.controller';
import { DesignService } from './design.service';
import { TimelineService } from './timeline.service';
import { VenuesService } from './venues.service';

/**
 * The write side of the invitation: templates, theme, block content, RSVP
 * questions, venues and the running order. Reading an invitation is
 * `invitations/`, which serves the public, cached payload.
 */
@Module({
  controllers: [DesignController],
  providers: [DesignService, VenuesService, TimelineService],
  exports: [DesignService, VenuesService, TimelineService],
})
export class DesignModule {}
