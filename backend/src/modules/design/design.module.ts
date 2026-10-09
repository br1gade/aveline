import { Module } from '@nestjs/common';
import { DesignController } from './design.controller';
import { DesignService } from './design.service';
import { DraftReaderService } from './draft-reader.service';
import { TimelineService } from './timeline.service';
import { VenueDirectoryController } from './venue-directory.controller';
import { VenuesService } from './venues.service';

/**
 * The host's side of the invitation: templates, theme, block content, RSVP
 * questions, venues and the running order — and reading all of it back to
 * edit. The guest's side is `invitations/`, which serves the public, cached
 * payload in one language.
 */
@Module({
  controllers: [DesignController, VenueDirectoryController],
  providers: [DesignService, VenuesService, TimelineService, DraftReaderService],
  exports: [DesignService, VenuesService, TimelineService],
})
export class DesignModule {}
