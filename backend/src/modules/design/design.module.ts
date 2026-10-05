import { Module } from '@nestjs/common';
import { DesignController } from './design.controller';
import { DesignService } from './design.service';
import { VenuesService } from './venues.service';

/**
 * The write side of the invitation: templates, theme, block content, RSVP
 * questions and venues. Reading an invitation is `invitations/`, which serves
 * the public, cached payload.
 */
@Module({
  controllers: [DesignController],
  providers: [DesignService, VenuesService],
  exports: [DesignService, VenuesService],
})
export class DesignModule {}
