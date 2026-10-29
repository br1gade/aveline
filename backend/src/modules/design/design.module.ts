import { TemplateContextInterceptor } from './templates/template-context.interceptor';
import { TemplateAdoptionController } from './templates/template-adoption.controller';
import { TemplateAdoptionService } from './templates/template-adoption.service';
import { PrivateStorageModule } from '../../infra/storage/private/private-storage.module';
import { TemplateAssetsController } from './templates/template-assets.controller';
import { TemplateAssetsService } from './templates/template-assets.service';
import { TemplateCapabilitiesService } from './templates/capabilities/template-capabilities.service';
import { TemplateAuthoringController } from './templates/template-authoring.controller';
import { TemplateAuthoringService } from './templates/template-authoring.service';
import { TemplateGatesService } from './templates/template-gates.service';
import { TemplatePreviewsController } from './template-previews.controller';
import { TemplatePreviewsService } from './template-previews.service';
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
  imports: [PrivateStorageModule],
  controllers: [TemplateAdoptionController, TemplateAssetsController, TemplateAuthoringController, TemplatePreviewsController, DesignController, VenueDirectoryController],
  providers: [TemplateContextInterceptor, TemplateAdoptionService, TemplateAssetsService, TemplateCapabilitiesService, TemplateAuthoringService, TemplateGatesService, TemplatePreviewsService, DesignService, VenuesService, TimelineService, DraftReaderService],
  exports: [DesignService, VenuesService, TimelineService],
})
export class DesignModule {}
