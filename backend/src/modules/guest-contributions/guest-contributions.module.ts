import { ContributionPrivacyController } from './contribution-privacy.controller';
import { ContributionPrivacyFiles } from './contribution-privacy';
import { TicketAcknowledgementInviter } from './ticket-acknowledgement-inviter';
import { Module } from '@nestjs/common';
import { PrivateStorageModule } from '../../infra/storage/private/private-storage.module';
import { AcknowledgementsService } from './acknowledgements.service';
import { GuestMediaService } from './guest-media.service';
import { ContributionsController } from './contributions.controller';
import { ContributionsHostController } from './contributions-host.controller';

@Module({ imports: [PrivateStorageModule], providers: [TicketAcknowledgementInviter, ContributionPrivacyFiles, AcknowledgementsService, GuestMediaService], exports: [TicketAcknowledgementInviter], controllers: [ContributionPrivacyController, ContributionsController, ContributionsHostController] })
export class GuestContributionsModule {}
