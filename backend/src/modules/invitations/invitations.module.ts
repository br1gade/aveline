import { Module } from '@nestjs/common';
import { ArrangementService } from './arrangement.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { InvitationSenderService } from './sending/invitation-sender.service';

@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService, ArrangementService, InvitationSenderService],
  exports: [InvitationsService, ArrangementService, InvitationSenderService],
})
export class InvitationsModule {}
