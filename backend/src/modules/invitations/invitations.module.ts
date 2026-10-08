import { Module } from '@nestjs/common';
import { ArrangementService } from './arrangement.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { InvitationSenderService } from './sending/invitation-sender.service';
import { ReminderService } from './sending/reminder.service';
import { RsvpConfirmerService } from './sending/rsvp-confirmer.service';

@Module({
  controllers: [InvitationsController],
  providers: [
    InvitationsService,
    ArrangementService,
    InvitationSenderService,
    ReminderService,
    RsvpConfirmerService,
  ],
  exports: [
    InvitationsService,
    ArrangementService,
    InvitationSenderService,
    ReminderService,
    RsvpConfirmerService,
  ],
})
export class InvitationsModule {}
